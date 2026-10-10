//! Per-deck effects with two knobs, STR (strength) and SPD (speed):
//! - **Echo**: beat-synced echo; SPD picks ¼, ½, ¾, 1 or 2 beats, STR the echo level.
//! - **Flanger**: short swept delay; SPD sets the sweep (8 s … ¼ s per cycle), STR the depth.
//! - **Filter**: low-pass swept up and down; SPD sets the sweep, STR how much is filtered.
//!
//! STR at 0 (or Off) passes the sound through untouched. Everything is allocated in `new`.

use crate::effects::Echo;
use crate::eq::Smoothed;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FxKind {
    #[default]
    Off,
    Echo,
    Flanger,
    Filter,
}

impl FxKind {
    pub const ALL: [FxKind; 4] = [Self::Off, Self::Echo, Self::Flanger, Self::Filter];
}

/// Echo lengths in beats, chosen by SPD (0 … 1 in five steps).
pub const ECHO_BEATS: [f64; 5] = [0.25, 0.5, 0.75, 1.0, 2.0];
const ECHO_MAX_SECONDS: f64 = 4.0;
const ECHO_FEEDBACK: f32 = 0.45;
/// Flanger delay sweeps between these (seconds).
const FLANGER_MIN: f64 = 0.0005;
const FLANGER_MAX: f64 = 0.0055;
const FLANGER_FEEDBACK: f32 = 0.5;
/// Filter sweep range (Hz).
const FILTER_LOW_HZ: f64 = 250.0;
const FILTER_HIGH_HZ: f64 = 9000.0;
/// Filter coefficients are recomputed this often (frames).
const FILTER_UPDATE: u32 = 32;

/// Echo length in beats for an SPD knob position.
pub fn echo_beats(speed: f32) -> f64 {
    let i = (speed.clamp(0.0, 1.0) * (ECHO_BEATS.len() - 1) as f32).round() as usize;
    ECHO_BEATS[i.min(ECHO_BEATS.len() - 1)]
}

/// Sweep period in seconds for an SPD knob position (0 = slow 8 s, 1 = fast ¼ s).
pub fn sweep_seconds(speed: f32) -> f64 {
    let s = f64::from(speed.clamp(0.0, 1.0));
    8.0 * (0.25f64 / 8.0).powf(s)
}

#[derive(Debug, Clone)]
pub struct DeckFx {
    sample_rate: f64,
    kind: FxKind,
    strength: Smoothed,
    speed: f32,
    beat_seconds: f64,
    echo: Echo,
    // Flanger: a short delay line.
    fl_buf: Vec<[f32; 2]>,
    fl_pos: usize,
    // Sweep position 0 … 1 (flanger and filter).
    phase: f64,
    // Filter: state-variable filter state and coefficients.
    svf: [[f32; 2]; 2],
    g: f32,
    k: f32,
    countdown: u32,
}

impl DeckFx {
    /// Allocates: create off the audio thread.
    pub fn new(sample_rate: u32) -> Self {
        let sr = f64::from(sample_rate.max(1));
        let fl_len = ((FLANGER_MAX * sr) as usize + 4).max(8);
        let mut fx = Self {
            sample_rate: sr,
            kind: FxKind::Off,
            strength: Smoothed::new(0.0, sample_rate),
            speed: 0.5,
            beat_seconds: 0.5,
            echo: Echo::new(sample_rate, ECHO_MAX_SECONDS),
            fl_buf: vec![[0.0; 2]; fl_len],
            fl_pos: 0,
            phase: 0.0,
            svf: [[0.0; 2]; 2],
            g: 0.0,
            k: 1.0 / 0.8,
            countdown: 0,
        };
        fx.echo.set_feedback(ECHO_FEEDBACK);
        fx.update_echo();
        fx
    }

    pub fn kind(&self) -> FxKind {
        self.kind
    }

    /// Switches the effect; the old one's tail is cleared so nothing old rings on.
    pub fn set_kind(&mut self, kind: FxKind) {
        if kind != self.kind {
            self.kind = kind;
            self.echo.clear();
            self.echo.set_send(1.0);
            self.fl_buf.iter_mut().for_each(|f| *f = [0.0; 2]);
            self.svf = [[0.0; 2]; 2];
            self.phase = 0.0;
            self.countdown = 0;
        }
    }

    /// STR and SPD, both 0 … 1.
    pub fn set_params(&mut self, strength: f32, speed: f32) {
        let clean = |v: f32, d: f32| if v.is_nan() { d } else { v.clamp(0.0, 1.0) };
        self.strength.set(clean(strength, 0.0));
        self.speed = clean(speed, 0.5);
        self.update_echo();
    }

    /// Length of one beat of the deck's track (from its BPM and tempo), for the echo.
    pub fn set_beat_seconds(&mut self, seconds: f64) {
        if seconds.is_finite() && seconds > 0.05 {
            self.beat_seconds = seconds.min(2.0);
            self.update_echo();
        }
    }

    pub fn params(&self) -> (f32, f32) {
        (self.strength.target(), self.speed)
    }

    fn update_echo(&mut self) {
        let frames = echo_beats(self.speed) * self.beat_seconds * self.sample_rate;
        self.echo.set_delay(frames.round() as usize);
        self.echo.set_send(1.0);
    }

    pub fn snap(&mut self) {
        self.strength.snap();
    }

    /// Processes interleaved stereo in place. Realtime-safe.
    pub fn process(&mut self, buf: &mut [f32]) {
        match self.kind {
            FxKind::Off => {}
            FxKind::Echo => {
                for f in buf.as_chunks_mut::<2>().0 {
                    let s = self.strength.step();
                    let (wl, wr) = self.echo.tick(f[0], f[1]);
                    f[0] += wl * s;
                    f[1] += wr * s;
                }
            }
            FxKind::Flanger => {
                let n = self.fl_buf.len();
                let step = 1.0 / (sweep_seconds(self.speed) * self.sample_rate);
                for f in buf.as_chunks_mut::<2>().0 {
                    let s = self.strength.step();
                    let lfo = 0.5 - 0.5 * (std::f64::consts::TAU * self.phase).cos();
                    self.phase = (self.phase + step).fract();
                    let delay =
                        (FLANGER_MIN + (FLANGER_MAX - FLANGER_MIN) * lfo) * self.sample_rate;
                    let read = self.fl_pos as f64 + n as f64 - delay;
                    let i0 = read.floor() as usize % n;
                    let i1 = (i0 + 1) % n;
                    let t = read.fract() as f32;
                    let d = [
                        self.fl_buf[i0][0] + (self.fl_buf[i1][0] - self.fl_buf[i0][0]) * t,
                        self.fl_buf[i0][1] + (self.fl_buf[i1][1] - self.fl_buf[i0][1]) * t,
                    ];
                    self.fl_buf[self.fl_pos] = [
                        f[0] + d[0] * FLANGER_FEEDBACK,
                        f[1] + d[1] * FLANGER_FEEDBACK,
                    ];
                    self.fl_pos = (self.fl_pos + 1) % n;
                    // Dry + delayed; the sum is scaled so the level stays about the same.
                    let norm = 1.0 / (1.0 + s);
                    f[0] = (f[0] + d[0] * s) * norm;
                    f[1] = (f[1] + d[1] * s) * norm;
                }
            }
            FxKind::Filter => {
                let step = 1.0 / (sweep_seconds(self.speed) * self.sample_rate);
                for f in buf.as_chunks_mut::<2>().0 {
                    if self.countdown == 0 {
                        let lfo = 0.5 - 0.5 * (std::f64::consts::TAU * self.phase).cos();
                        let hz = FILTER_LOW_HZ * (FILTER_HIGH_HZ / FILTER_LOW_HZ).powf(lfo);
                        self.g = (std::f64::consts::PI * hz / self.sample_rate).tan() as f32;
                        self.countdown = FILTER_UPDATE;
                    }
                    self.countdown -= 1;
                    self.phase = (self.phase + step).fract();
                    let s = self.strength.step();
                    let (g, k) = (self.g, self.k);
                    let a1 = 1.0 / (1.0 + g * (g + k));
                    for (c, x) in f.iter_mut().enumerate() {
                        // Zavalishin's TPT state-variable filter, low-pass output.
                        let [ic1, ic2] = self.svf[c];
                        let v1 = a1 * (ic1 + g * (*x - ic2));
                        let v2 = ic2 + g * v1;
                        self.svf[c] = [2.0 * v1 - ic1, 2.0 * v2 - ic2];
                        *x = *x * (1.0 - s) + v2 * s;
                    }
                }
            }
        }
    }
}
