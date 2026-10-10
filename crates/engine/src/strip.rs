//! Mixer channel strip: trim → 3-band EQ → channel fader.

use crate::eq::{db_to_gain, Band, Smoothed, ThreeBandEq};

/// Most trim boost allowed.
pub const MAX_TRIM_DB: f32 = 12.0;

#[derive(Debug, Clone)]
pub struct ChannelStrip {
    trim: Smoothed,
    pub eq: ThreeBandEq,
    fader: Smoothed,
}

impl ChannelStrip {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            trim: Smoothed::new(1.0, sample_rate),
            eq: ThreeBandEq::new(sample_rate),
            fader: Smoothed::new(1.0, sample_rate),
        }
    }

    /// Input gain in dB (−∞ … +12 dB).
    pub fn set_trim_db(&mut self, db: f32) {
        let db = if db.is_nan() {
            0.0
        } else {
            db.min(MAX_TRIM_DB)
        };
        self.trim.set(db_to_gain(db));
    }

    /// Channel fader position 0 (closed) … 1 (full), applied as linear gain.
    pub fn set_fader(&mut self, position: f32) {
        let p = if position.is_nan() {
            0.0
        } else {
            position.clamp(0.0, 1.0)
        };
        self.fader.set(p);
    }

    pub fn set_eq_gain_db(&mut self, band: Band, db: f32) {
        self.eq.set_gain_db(band, db);
    }

    pub fn set_kill(&mut self, band: Band, kill: bool) {
        self.eq.set_kill(band, kill);
    }

    /// Jumps all parameters to their targets (no glide).
    pub fn snap(&mut self) {
        self.trim.snap();
        self.fader.snap();
        self.eq.snap();
    }

    /// Processes interleaved stereo in place. Realtime-safe.
    pub fn process(&mut self, buf: &mut [f32]) {
        for frame in buf.as_chunks_mut::<2>().0 {
            let t = self.trim.next();
            frame[0] *= t;
            frame[1] *= t;
        }
        self.eq.process(buf);
        for frame in buf.as_chunks_mut::<2>().0 {
            let f = self.fader.next();
            frame[0] *= f;
            frame[1] *= f;
        }
    }
}
