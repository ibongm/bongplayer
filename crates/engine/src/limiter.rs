//! Look-ahead peak limiter on the master output.
//!
//! Guarantees by construction that no output sample exceeds the ceiling:
//! 1. for each input sample, the gain it needs is `ceiling / peak` (or 1);
//! 2. a sliding minimum over the look-ahead window spreads that need backwards in time;
//! 3. release lets the gain recover slowly but never above that minimum;
//! 4. a moving average over the same window smooths the attack. Every value averaged for an
//!    output sample already respects that sample's need, so the average does too.
//!
//! The audio is delayed by the look-ahead (1.5 ms) so the gain is down before a peak arrives.

/// Default ceiling: −1 dBFS.
pub const DEFAULT_CEILING_DB: f32 = -1.0;
const LOOKAHEAD_SECONDS: f64 = 0.0015;
const RELEASE_SECONDS: f64 = 0.1;
/// Internal safety margin so float rounding can never land a hair above the ceiling.
const MARGIN: f32 = 1.0 - 1e-5;

#[derive(Debug, Clone)]
pub struct Limiter {
    ceiling: f32,
    len: usize,
    pos: usize,
    delay: Vec<[f32; 2]>,
    need: Vec<f32>,
    released: f32,
    release_coeff: f32,
    window: Vec<f32>,
    window_sum: f64,
}

impl Limiter {
    /// Allocates; call off the audio thread.
    pub fn new(sample_rate: u32) -> Self {
        let sr = f64::from(sample_rate.max(1));
        let len = ((LOOKAHEAD_SECONDS * sr).round() as usize).max(1);
        Self {
            ceiling: crate::eq::db_to_gain(DEFAULT_CEILING_DB),
            len,
            pos: 0,
            delay: vec![[0.0; 2]; len],
            need: vec![1.0; len],
            released: 1.0,
            release_coeff: (1.0 - (-1.0 / (RELEASE_SECONDS * sr)).exp()) as f32,
            window: vec![1.0; len],
            window_sum: len as f64,
        }
    }

    /// Ceiling in dBFS (clamped to −30 … 0 dB).
    pub fn set_ceiling_db(&mut self, db: f32) {
        let db = if db.is_nan() {
            DEFAULT_CEILING_DB
        } else {
            db.clamp(-30.0, 0.0)
        };
        self.ceiling = crate::eq::db_to_gain(db);
    }

    pub fn ceiling(&self) -> f32 {
        self.ceiling
    }

    /// Output delay in frames.
    pub fn latency(&self) -> usize {
        self.len - 1
    }

    /// Processes interleaved stereo in place. Realtime-safe.
    pub fn process(&mut self, buf: &mut [f32]) {
        let ceiling = self.ceiling * MARGIN;
        for frame in buf.as_chunks_mut::<2>().0 {
            let l = if frame[0].is_finite() { frame[0] } else { 0.0 };
            let r = if frame[1].is_finite() { frame[1] } else { 0.0 };
            let peak = l.abs().max(r.abs());
            let need = if peak > ceiling { ceiling / peak } else { 1.0 };

            self.need[self.pos] = need;
            let min_need = self.need.iter().copied().fold(1.0f32, f32::min);

            self.released += (1.0 - self.released) * self.release_coeff;
            self.released = self.released.min(min_need);

            self.window_sum += f64::from(self.released) - f64::from(self.window[self.pos]);
            self.window[self.pos] = self.released;

            self.delay[self.pos] = [l, r];
            let oldest = (self.pos + 1) % self.len;
            let [dl, dr] = self.delay[oldest];

            let gain = (self.window_sum / self.len as f64) as f32;
            frame[0] = dl * gain;
            frame[1] = dr * gain;

            self.pos = oldest;
            if self.pos == 0 {
                // Recompute the running sum once per window so rounding cannot drift.
                self.window_sum = self.window.iter().map(|&g| f64::from(g)).sum();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_signal_passes_unchanged_after_the_delay() {
        let mut lim = Limiter::new(48_000);
        let d = lim.latency();
        let input: Vec<f32> = (0..2000).map(|i| ((i as f32) * 0.01).sin() * 0.3).collect();
        let mut buf = input.clone();
        lim.process(&mut buf);
        for i in (2 * d..input.len()).step_by(2) {
            assert!((buf[i] - input[i - 2 * d]).abs() < 1e-6);
        }
    }
}
