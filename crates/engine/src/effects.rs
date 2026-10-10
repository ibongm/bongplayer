//! Small effects used by the mixer and Automix: an echo (for Echo-Out transitions) and a
//! ducker (smooth level dip for announcements, later for the sampler).

/// Feedback echo. Input is sent in with `send` (0 = nothing new goes in, the tail keeps
/// ringing); the output is only the echoes ("wet").
#[derive(Debug, Clone)]
pub struct Echo {
    buf: Vec<[f32; 2]>,
    pos: usize,
    delay: usize,
    feedback: f32,
    send: f32,
}

impl Echo {
    /// Allocates a delay line of up to `max_seconds`: create off the audio thread.
    pub fn new(sample_rate: u32, max_seconds: f64) -> Self {
        let len = ((f64::from(sample_rate.max(1)) * max_seconds) as usize).max(2);
        Self {
            buf: vec![[0.0; 2]; len],
            pos: 0,
            delay: len / 2,
            feedback: 0.55,
            send: 0.0,
        }
    }

    /// Echo time in frames (clamped to the delay line).
    pub fn set_delay(&mut self, frames: usize) {
        self.delay = frames.clamp(1, self.buf.len() - 1);
    }

    pub fn set_feedback(&mut self, feedback: f32) {
        self.feedback = feedback.clamp(0.0, 0.95);
    }

    pub fn set_send(&mut self, send: f32) {
        self.send = send.clamp(0.0, 1.0);
    }

    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|f| *f = [0.0; 2]);
        self.send = 0.0;
    }

    /// Returns the echo for one input frame. Realtime-safe.
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        let n = self.buf.len();
        let read = (self.pos + n - self.delay) % n;
        let [dl, dr] = self.buf[read];
        self.buf[self.pos] = [
            l * self.send + dl * self.feedback,
            r * self.send + dr * self.feedback,
        ];
        self.pos = (self.pos + 1) % n;
        (dl, dr)
    }
}

/// Lowers the level by `depth` dB when engaged, ramping linearly in dB: down over `attack`,
/// back up over `release`.
#[derive(Debug, Clone)]
pub struct Ducker {
    sample_rate: f64,
    current_db: f32,
    target_db: f32,
    down_per_frame: f32,
    up_per_frame: f32,
}

impl Ducker {
    pub fn new(sample_rate: u32) -> Self {
        let mut d = Self {
            sample_rate: f64::from(sample_rate.max(1)),
            current_db: 0.0,
            target_db: 0.0,
            down_per_frame: 0.0,
            up_per_frame: 0.0,
        };
        d.configure(12.0, 0.3, 0.6);
        d
    }

    /// Depth in dB (positive number), ramp times in seconds.
    pub fn configure(&mut self, depth_db: f32, attack_s: f64, release_s: f64) {
        let depth = depth_db.clamp(0.0, 60.0);
        let frames = |s: f64| (s.max(0.001) * self.sample_rate) as f32;
        self.down_per_frame = depth / frames(attack_s);
        self.up_per_frame = depth / frames(release_s);
        if self.target_db < 0.0 {
            self.target_db = -depth;
        }
    }

    /// Engages (lowers) or releases with the given depth.
    pub fn set(&mut self, on: bool, depth_db: f32) {
        self.target_db = if on { -depth_db.clamp(0.0, 60.0) } else { 0.0 };
    }

    /// Current attenuation in dB (0 = none, negative = ducked).
    pub fn level_db(&self) -> f32 {
        self.current_db
    }

    pub fn is_engaged(&self) -> bool {
        self.target_db < 0.0
    }

    /// Next gain (linear) for one frame. Realtime-safe.
    #[inline]
    pub fn step(&mut self) -> f32 {
        if self.current_db > self.target_db {
            self.current_db = (self.current_db - self.down_per_frame).max(self.target_db);
        } else if self.current_db < self.target_db {
            self.current_db = (self.current_db + self.up_per_frame).min(self.target_db);
        }
        // Float rounding must not leave the ramp a hair short of its target.
        if (self.current_db - self.target_db).abs() < 1e-3 {
            self.current_db = self.target_db;
        }
        if self.current_db == 0.0 {
            1.0
        } else {
            10f32.powf(self.current_db / 20.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_repeats_with_feedback() {
        let mut e = Echo::new(1000, 1.0);
        e.set_delay(100);
        e.set_feedback(0.5);
        e.set_send(1.0);
        let mut out = Vec::new();
        out.push(e.tick(1.0, 1.0).0);
        e.set_send(0.0);
        for _ in 0..400 {
            out.push(e.tick(0.0, 0.0).0);
        }
        assert!((out[100] - 1.0).abs() < 1e-6, "first echo after 100 frames");
        assert!((out[200] - 0.5).abs() < 1e-6, "second echo at half level");
        assert!((out[300] - 0.25).abs() < 1e-6);
        assert_eq!(out[150], 0.0);
    }

    #[test]
    fn ducker_ramps_down_and_up_in_the_set_times() {
        let mut d = Ducker::new(1000);
        d.configure(9.0, 0.05, 0.25);
        d.set(true, 9.0);
        for _ in 0..50 {
            d.step();
        }
        assert!(
            (d.level_db() + 9.0).abs() < 1e-3,
            "−9 dB after 50 ms: {}",
            d.level_db()
        );
        d.set(false, 9.0);
        for _ in 0..125 {
            d.step();
        }
        assert!(
            (d.level_db() + 4.5).abs() < 0.05,
            "half way back after 125 ms"
        );
        for _ in 0..125 {
            d.step();
        }
        assert_eq!(d.level_db(), 0.0);
        assert_eq!(d.step(), 1.0);
    }
}
