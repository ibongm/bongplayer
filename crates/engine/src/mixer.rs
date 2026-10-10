//! Two channel strips → constant-power crossfader → (ducking) → + sampler → master gain →
//! limiter. The sampler joins after the crossfader, so deck faders never touch it.

use crate::effects::Ducker;
use crate::eq::{db_to_gain, Smoothed};
use crate::limiter::Limiter;
use crate::strip::ChannelStrip;

/// The music drops this far while a sampler pad plays…
pub const SAMPLER_DUCK_DB: f32 = 9.0;
/// …over this long…
pub const SAMPLER_DUCK_ATTACK_SECONDS: f64 = 0.050;
/// …and comes back over this long after the last pad stops.
pub const SAMPLER_DUCK_RELEASE_SECONDS: f64 = 0.250;

/// Most master boost allowed.
pub const MAX_MASTER_DB: f32 = 6.0;

/// Constant-power crossfader law: position 0 = only A, 0.5 = both at −3 dB, 1 = only B.
/// `a² + b² = 1` everywhere.
pub fn crossfader_gains(position: f32) -> (f32, f32) {
    let p = if position.is_nan() {
        0.5
    } else {
        position.clamp(0.0, 1.0)
    };
    let angle = p * std::f32::consts::FRAC_PI_2;
    (angle.cos(), angle.sin())
}

#[derive(Debug, Clone)]
pub struct Mixer {
    pub strips: [ChannelStrip; 2],
    crossfader: Smoothed,
    master: Smoothed,
    /// Lowers the music for announcements (DUCK).
    pub ducker: Ducker,
    /// Lowers the music while a sampler pad plays.
    pub sampler_duck: Ducker,
    pub limiter: Limiter,
}

impl Mixer {
    /// Allocates; call off the audio thread.
    pub fn new(sample_rate: u32) -> Self {
        Self {
            strips: [
                ChannelStrip::new(sample_rate),
                ChannelStrip::new(sample_rate),
            ],
            crossfader: Smoothed::new(0.5, sample_rate),
            master: Smoothed::new(1.0, sample_rate),
            ducker: Ducker::new(sample_rate),
            sampler_duck: {
                let mut d = Ducker::new(sample_rate);
                d.configure(
                    SAMPLER_DUCK_DB,
                    SAMPLER_DUCK_ATTACK_SECONDS,
                    SAMPLER_DUCK_RELEASE_SECONDS,
                );
                d
            },
            limiter: Limiter::new(sample_rate),
        }
    }

    pub fn set_crossfader(&mut self, position: f32) {
        let p = if position.is_nan() {
            0.5
        } else {
            position.clamp(0.0, 1.0)
        };
        self.crossfader.set(p);
    }

    pub fn crossfader(&self) -> f32 {
        self.crossfader.target()
    }

    /// Master gain in dB (−∞ … +6 dB).
    pub fn set_master_db(&mut self, db: f32) {
        let db = if db.is_nan() {
            0.0
        } else {
            db.min(MAX_MASTER_DB)
        };
        self.master.set(db_to_gain(db));
    }

    /// Jumps all parameters to their targets (no glide).
    pub fn snap(&mut self) {
        self.crossfader.snap();
        self.master.snap();
        self.strips.iter_mut().for_each(ChannelStrip::snap);
    }

    /// Mixes deck A and deck B (interleaved stereo, modified in place by the strips) into `out`.
    /// All three slices must have the same length. Realtime-safe.
    pub fn process(&mut self, a: &mut [f32], b: &mut [f32], out: &mut [f32]) {
        self.process_with_sampler(a, b, None, out);
    }

    /// Like [`Mixer::process`], plus the sampler bus (same length), which skips the channel
    /// strips, faders, crossfader and ducking. Realtime-safe.
    pub fn process_with_sampler(
        &mut self,
        a: &mut [f32],
        b: &mut [f32],
        sampler: Option<&[f32]>,
        out: &mut [f32],
    ) {
        let [strip_a, strip_b] = &mut self.strips;
        strip_a.process(a);
        strip_b.process(b);
        let frames = out.as_chunks_mut::<2>().0;
        let a = a.as_chunks::<2>().0;
        let b = b.as_chunks::<2>().0;
        let silent: &[[f32; 2]] = &[];
        let pads = sampler.map_or(silent, |s| s.as_chunks::<2>().0);
        for (i, ((o, fa), fb)) in frames.iter_mut().zip(a).zip(b).enumerate() {
            let (ga, gb) = crossfader_gains(self.crossfader.step());
            let master = self.master.step();
            let music = master * self.ducker.step() * self.sampler_duck.step();
            let s = pads.get(i).copied().unwrap_or([0.0, 0.0]);
            o[0] = (fa[0] * ga + fb[0] * gb) * music + s[0] * master;
            o[1] = (fa[1] * ga + fb[1] * gb) * music + s[1] * master;
        }
        self.limiter.process(out);
    }
}
