//! One-knob DJ filter: centre = off, left = low-pass (cuts treble), right = high-pass (cuts
//! bass). The cutoff sweeps exponentially so the knob feels even across its travel.

use crate::eq::Smoothed;

/// Below this knob value the filter is bypassed completely.
const DEAD_ZONE: f32 = 0.02;
/// Cutoff range: low-pass 20 kHz → 80 Hz, high-pass 20 Hz → 8 kHz.
const LP_TOP: f64 = 20_000.0;
const LP_BOTTOM: f64 = 80.0;
const HP_BOTTOM: f64 = 20.0;
const HP_TOP: f64 = 8_000.0;
/// Slight resonance, like DJ mixer filters.
const Q: f64 = 0.9;
/// Coefficients are recomputed every this many frames while the knob moves.
const UPDATE: usize = 32;

#[derive(Debug, Clone, Copy, Default)]
struct Section {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z: [[f64; 2]; 2],
}

impl Section {
    fn design(&mut self, sample_rate: f64, freq: f64, highpass: bool) {
        let f = freq.clamp(10.0, sample_rate * 0.45);
        let w0 = 2.0 * std::f64::consts::PI * f / sample_rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * Q);
        let a0 = 1.0 + alpha;
        let (b0, b1, b2) = if highpass {
            ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0)
        } else {
            ((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0)
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = -2.0 * cos / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    #[inline]
    fn process(&mut self, ch: usize, x: f64) -> f64 {
        let z = &mut self.z[ch];
        let y = self.b0 * x + z[0];
        z[0] = self.b1 * x - self.a1 * y + z[1];
        z[1] = self.b2 * x - self.a2 * y;
        y
    }

    fn reset(&mut self) {
        self.z = [[0.0; 2]; 2];
    }
}

#[derive(Debug, Clone)]
pub struct DjFilter {
    sample_rate: f64,
    knob: Smoothed,
    section: Section,
    /// Mode of the current coefficients: -1 low-pass, 0 bypass, +1 high-pass.
    mode: i8,
}

/// Cutoff for a knob value in −1 … 1 (0 = none). Returns (frequency, high-pass?).
pub fn cutoff(knob: f32) -> Option<(f64, bool)> {
    let k = f64::from(knob.clamp(-1.0, 1.0));
    if k.abs() < f64::from(DEAD_ZONE) {
        None
    } else if k < 0.0 {
        Some((LP_TOP * (LP_BOTTOM / LP_TOP).powf(-k), false))
    } else {
        Some((HP_BOTTOM * (HP_TOP / HP_BOTTOM).powf(k), true))
    }
}

impl DjFilter {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate: f64::from(sample_rate.max(1)),
            knob: Smoothed::new(0.0, sample_rate),
            section: Section::default(),
            mode: 0,
        }
    }

    /// Knob position −1 (low-pass fully closed) … 0 (off) … +1 (high-pass fully closed).
    pub fn set(&mut self, knob: f32) {
        let k = if knob.is_nan() {
            0.0
        } else {
            knob.clamp(-1.0, 1.0)
        };
        self.knob.set(k);
    }

    pub fn snap(&mut self) {
        self.knob.snap();
    }

    fn update(&mut self, knob: f32) {
        match cutoff(knob) {
            None => {
                if self.mode != 0 {
                    self.section.reset();
                }
                self.mode = 0;
            }
            Some((f, hp)) => {
                let mode = if hp { 1 } else { -1 };
                if mode != self.mode {
                    self.section.reset();
                }
                self.mode = mode;
                self.section.design(self.sample_rate, f, hp);
            }
        }
    }

    /// Processes interleaved stereo in place. Realtime-safe.
    pub fn process(&mut self, buf: &mut [f32]) {
        for block in buf.chunks_mut(2 * UPDATE) {
            // Advance the knob glide by the block and design once per block.
            let mut k = 0.0;
            for _ in 0..block.len() / 2 {
                k = self.knob.step();
            }
            self.update(k);
            if self.mode == 0 {
                continue;
            }
            for frame in block.as_chunks_mut::<2>().0 {
                frame[0] = self.section.process(0, f64::from(frame[0])) as f32;
                frame[1] = self.section.process(1, f64::from(frame[1])) as f32;
            }
        }
    }
}
