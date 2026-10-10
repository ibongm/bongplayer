//! Two channel strips → constant-power crossfader → master gain → limiter.

use crate::eq::{db_to_gain, Smoothed};
use crate::limiter::Limiter;
use crate::strip::ChannelStrip;

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
        let [strip_a, strip_b] = &mut self.strips;
        strip_a.process(a);
        strip_b.process(b);
        let frames = out.as_chunks_mut::<2>().0;
        let a = a.as_chunks::<2>().0;
        let b = b.as_chunks::<2>().0;
        for ((o, fa), fb) in frames.iter_mut().zip(a).zip(b) {
            let (ga, gb) = crossfader_gains(self.crossfader.step());
            let m = self.master.step();
            o[0] = (fa[0] * ga + fb[0] * gb) * m;
            o[1] = (fa[1] * ga + fb[1] * gb) * m;
        }
        self.limiter.process(out);
    }
}
