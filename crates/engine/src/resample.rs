//! Windowed-sinc interpolation: reads a track at any fractional position.
//!
//! The deck moves a fractional read head through the track; this reconstructs the signal
//! between samples. The same code resamples (44.1 kHz file on a 48 kHz device) and, from M2,
//! handles pitch, reverse and scratching, which a stream resampler cannot do.

use crate::track::TrackBuffer;

/// Kernel half-width in samples; the kernel spans `2 * HALF_TAPS` input samples.
pub const HALF_TAPS: usize = 32;
const TAPS: usize = HALF_TAPS * 2;
/// Number of fractional positions stored; values in between are linearly interpolated.
const PHASES: usize = 1024;
/// Kaiser window shape: about −90 dB stop-band.
const KAISER_BETA: f64 = 9.0;

/// Precomputed interpolation kernel. Built on a control thread (it allocates), then shared
/// with the audio thread.
pub struct SincTable {
    cutoff: f64,
    /// `(PHASES + 1) * TAPS` coefficients; row `p` is the kernel for fractional offset `p / PHASES`.
    coeffs: Box<[f32]>,
}

impl std::fmt::Debug for SincTable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SincTable")
            .field("cutoff", &self.cutoff)
            .finish()
    }
}

/// Zeroth-order modified Bessel function (series), for the Kaiser window.
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..64 {
        term *= q / (k as f64 * k as f64);
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

impl SincTable {
    /// `cutoff` is the pass-band edge relative to the source Nyquist frequency, in (0, 1].
    /// Use 1.0 when the output rate is at least the file rate, otherwise `out_rate / file_rate`.
    pub fn new(cutoff: f64) -> Self {
        let cutoff = cutoff.clamp(0.01, 1.0);
        let i0_beta = bessel_i0(KAISER_BETA);
        let half = HALF_TAPS as f64;
        let mut coeffs = vec![0.0f32; (PHASES + 1) * TAPS];
        for (p, row) in coeffs.as_chunks_mut::<TAPS>().0.iter_mut().enumerate() {
            let frac = p as f64 / PHASES as f64;
            let mut sum = 0.0f64;
            let mut vals = [0.0f64; TAPS];
            for (j, v) in vals.iter_mut().enumerate() {
                // Distance from the read position to input sample (i + k), k = j - HALF + 1.
                let t = (j as f64 - half + 1.0) - frac;
                let x = std::f64::consts::PI * cutoff * t;
                let sinc = if x.abs() < 1e-12 { 1.0 } else { x.sin() / x };
                let r = t / half;
                let window = if r.abs() >= 1.0 {
                    0.0
                } else {
                    bessel_i0(KAISER_BETA * (1.0 - r * r).sqrt()) / i0_beta
                };
                *v = cutoff * sinc * window;
                sum += *v;
            }
            // Unity gain at DC for every phase.
            for (c, v) in row.iter_mut().zip(vals) {
                *c = (v / sum) as f32;
            }
        }
        Self {
            cutoff,
            coeffs: coeffs.into_boxed_slice(),
        }
    }

    /// Kernel for playing a file at `file_rate` on a device at `out_rate` at normal speed.
    pub fn for_rates(file_rate: u32, out_rate: u32) -> Self {
        Self::new((f64::from(out_rate) / f64::from(file_rate)).min(1.0))
    }

    pub fn cutoff(&self) -> f64 {
        self.cutoff
    }

    /// Signal value at fractional frame `pos`. Realtime-safe (no allocation, atomics only).
    #[inline]
    pub fn read(&self, track: &TrackBuffer, pos: f64) -> (f32, f32) {
        let base = pos.floor();
        let i = base as i64;
        let frac = pos - base;
        // Exactly on a sample with an identity kernel: return it untouched (bit-exact playback).
        if frac == 0.0 && self.cutoff >= 1.0 {
            return track.frame(i);
        }
        let ph = frac * PHASES as f64;
        let p = (ph as usize).min(PHASES - 1);
        let w = (ph - p as f64) as f32;
        let row_a = &self.coeffs[p * TAPS..(p + 1) * TAPS];
        let row_b = &self.coeffs[(p + 1) * TAPS..(p + 2) * TAPS];
        let first = i - HALF_TAPS as i64 + 1;
        let (mut l, mut r) = (0.0f32, 0.0f32);
        for (j, (a, b)) in row_a.iter().zip(row_b).enumerate() {
            let c = a + (b - a) * w;
            let (x, y) = track.frame(first + j as i64);
            l += c * x;
            r += c * y;
        }
        (l, r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_kernel_at_integer_phase() {
        let t = SincTable::new(1.0);
        let row = &t.coeffs[..TAPS];
        for (j, c) in row.iter().enumerate() {
            let expected = if j == HALF_TAPS - 1 { 1.0 } else { 0.0 };
            assert!((c - expected).abs() < 1e-6, "tap {j}: {c}");
        }
    }

    #[test]
    fn every_phase_has_unity_dc_gain() {
        let t = SincTable::new(0.9);
        for row in t.coeffs.as_chunks::<TAPS>().0 {
            let s: f32 = row.iter().sum();
            assert!((s - 1.0).abs() < 1e-5);
        }
    }

    #[test]
    fn halfway_between_two_equal_samples_is_that_value() {
        let buf = TrackBuffer::from_interleaved(48_000, &[0.25; 2 * 200]);
        let t = SincTable::new(1.0);
        let (l, r) = t.read(&buf, 100.5);
        assert!(
            (l - 0.25).abs() < 1e-4 && (r - 0.25).abs() < 1e-4,
            "{l} {r}"
        );
    }
}
