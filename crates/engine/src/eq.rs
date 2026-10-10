//! 3-band isolator EQ (DJ mixer style) built from Linkwitz-Riley crossovers.
//!
//! The signal is split into low / mid / high at 300 Hz and 4 kHz with 8th-order (48 dB/octave)
//! Linkwitz-Riley filters. The low band passes through an all-pass matching the 4 kHz split, so
//! the three bands add back up to a flat response when all gains are 0 dB. Each band has its own
//! gain (−∞ … +6 dB) and a kill switch.

/// Crossover between low and mid.
pub const LOW_MID_HZ: f64 = 300.0;
/// Crossover between mid and high.
pub const MID_HIGH_HZ: f64 = 4_000.0;
/// Highest band boost.
pub const MAX_BAND_GAIN_DB: f32 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Band {
    Low = 0,
    Mid = 1,
    High = 2,
}

impl Band {
    pub const ALL: [Band; 3] = [Band::Low, Band::Mid, Band::High];
}

/// Second-order section, transposed direct form II, f64 for accuracy at low frequencies.
#[derive(Debug, Clone, Copy, Default)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    /// RBJ cookbook low-pass / high-pass.
    fn new(sample_rate: f64, freq: f64, q: f64, highpass: bool) -> Self {
        let w0 = 2.0 * std::f64::consts::PI * freq / sample_rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let a0 = 1.0 + alpha;
        let (b0, b1, b2) = if highpass {
            ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0)
        } else {
            ((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0)
        };
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: -2.0 * cos / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// 8th-order Linkwitz-Riley filter = 4th-order Butterworth applied twice.
#[derive(Debug, Clone, Copy)]
struct Lr8 {
    stages: [Biquad; 4],
}

impl Lr8 {
    fn new(sample_rate: f64, freq: f64, highpass: bool) -> Self {
        // Q values of the two sections of a 4th-order Butterworth filter.
        const Q1: f64 = 0.541_196_100_146_197;
        const Q2: f64 = 1.306_562_964_876_376_5;
        let a = Biquad::new(sample_rate, freq, Q1, highpass);
        let b = Biquad::new(sample_rate, freq, Q2, highpass);
        Self {
            stages: [a, b, a, b],
        }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        self.stages.iter_mut().fold(x, |s, st| st.process(s))
    }
}

/// One audio channel of the isolator.
#[derive(Debug, Clone, Copy)]
struct Splitter {
    low_lp: Lr8,
    low_ap_lp: Lr8,
    low_ap_hp: Lr8,
    rest_hp: Lr8,
    mid_lp: Lr8,
    high_hp: Lr8,
}

impl Splitter {
    fn new(sr: f64) -> Self {
        Self {
            low_lp: Lr8::new(sr, LOW_MID_HZ, false),
            low_ap_lp: Lr8::new(sr, MID_HIGH_HZ, false),
            low_ap_hp: Lr8::new(sr, MID_HIGH_HZ, true),
            rest_hp: Lr8::new(sr, LOW_MID_HZ, true),
            mid_lp: Lr8::new(sr, MID_HIGH_HZ, false),
            high_hp: Lr8::new(sr, MID_HIGH_HZ, true),
        }
    }

    /// Returns (low, mid, high); their sum is an all-pass version of `x`.
    #[inline]
    fn split(&mut self, x: f64) -> (f64, f64, f64) {
        let low = self.low_lp.process(x);
        // All-pass at 4 kHz (LP + HP of the same crossover) to keep the low band in phase.
        let low = self.low_ap_lp.process(low) + self.low_ap_hp.process(low);
        let rest = self.rest_hp.process(x);
        (low, self.mid_lp.process(rest), self.high_hp.process(rest))
    }
}

/// A parameter that glides to its target to avoid clicks (≈ 5 ms time constant).
#[derive(Debug, Clone, Copy)]
pub struct Smoothed {
    current: f32,
    target: f32,
    coeff: f32,
}

impl Smoothed {
    pub fn new(value: f32, sample_rate: u32) -> Self {
        let tau_samples = 0.005 * sample_rate.max(1) as f32;
        Self {
            current: value,
            target: value,
            coeff: 1.0 - (-1.0 / tau_samples).exp(),
        }
    }

    pub fn set(&mut self, target: f32) {
        self.target = target;
    }

    /// Jumps straight to the target (used when nothing is playing yet).
    pub fn snap(&mut self) {
        self.current = self.target;
    }

    pub fn target(&self) -> f32 {
        self.target
    }

    /// Advances one sample and returns the current value.
    #[inline]
    pub fn step(&mut self) -> f32 {
        let d = self.target - self.current;
        if d.abs() < 1e-7 {
            self.current = self.target;
        } else {
            self.current += d * self.coeff;
        }
        self.current
    }
}

/// dB to linear amplitude; −∞ dB (or below −120) gives 0.
pub fn db_to_gain(db: f32) -> f32 {
    if db <= -120.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

/// Stereo 3-band isolator with per-band gain and kill.
#[derive(Debug, Clone)]
pub struct ThreeBandEq {
    channels: [Splitter; 2],
    gain_db: [f32; 3],
    kill: [bool; 3],
    gains: [Smoothed; 3],
}

impl ThreeBandEq {
    pub fn new(sample_rate: u32) -> Self {
        let sr = f64::from(sample_rate);
        Self {
            channels: [Splitter::new(sr), Splitter::new(sr)],
            gain_db: [0.0; 3],
            kill: [false; 3],
            gains: [Smoothed::new(1.0, sample_rate); 3],
        }
    }

    /// Band gain in dB, clamped to −∞ … +6 dB.
    pub fn set_gain_db(&mut self, band: Band, db: f32) {
        let db = if db.is_nan() {
            0.0
        } else {
            db.min(MAX_BAND_GAIN_DB)
        };
        self.gain_db[band as usize] = db;
        self.update(band);
    }

    pub fn set_kill(&mut self, band: Band, kill: bool) {
        self.kill[band as usize] = kill;
        self.update(band);
    }

    pub fn gain_db(&self, band: Band) -> f32 {
        self.gain_db[band as usize]
    }

    pub fn is_killed(&self, band: Band) -> bool {
        self.kill[band as usize]
    }

    fn update(&mut self, band: Band) {
        let i = band as usize;
        let g = if self.kill[i] {
            0.0
        } else {
            db_to_gain(self.gain_db[i])
        };
        self.gains[i].set(g);
    }

    /// Jumps all band gains to their targets.
    pub fn snap(&mut self) {
        self.gains.iter_mut().for_each(Smoothed::snap);
    }

    /// Processes interleaved stereo in place. Realtime-safe.
    pub fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.as_chunks_mut::<2>().0 {
            let gl = f64::from(self.gains[0].step());
            let gm = f64::from(self.gains[1].step());
            let gh = f64::from(self.gains[2].step());
            for (s, ch) in frame.iter_mut().zip(self.channels.iter_mut()) {
                let (l, m, h) = ch.split(f64::from(*s));
                *s = (gl * l + gm * m + gh * h) as f32;
            }
        }
    }
}
