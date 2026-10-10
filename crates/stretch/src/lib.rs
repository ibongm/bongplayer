//! Pitch shifter / time stretcher for key lock, wrapping the vendored Signalsmith Stretch
//! (MIT). Interleaved stereo.

use std::os::raw::c_int;
use std::ptr::NonNull;

#[repr(C)]
struct RawStretch {
    _private: [u8; 0],
}

extern "C" {
    fn bong_stretch_new(channels: c_int, sample_rate: f32) -> *mut RawStretch;
    fn bong_stretch_free(s: *mut RawStretch);
    fn bong_stretch_reset(s: *mut RawStretch);
    fn bong_stretch_input_latency(s: *const RawStretch) -> c_int;
    fn bong_stretch_output_latency(s: *const RawStretch) -> c_int;
    fn bong_stretch_set_transpose(s: *mut RawStretch, factor: f32);
    fn bong_stretch_process(
        s: *mut RawStretch,
        input: *mut f32,
        input_frames: c_int,
        output: *mut f32,
        output_frames: c_int,
    );
}

/// A stereo Signalsmith Stretch instance.
pub struct Stretch {
    raw: NonNull<RawStretch>,
}

// The instance is owned exclusively and only used from one thread at a time.
unsafe impl Send for Stretch {}

impl Stretch {
    /// Creates a stereo stretcher for `sample_rate`. Allocates: not on the audio thread.
    /// Returns `None` if memory could not be allocated.
    pub fn new(sample_rate: u32) -> Option<Self> {
        // SAFETY: plain constructor; returns null on allocation failure.
        let raw = unsafe { bong_stretch_new(2, sample_rate as f32) };
        NonNull::new(raw).map(|raw| Self { raw })
    }

    /// Clears internal buffers (after a jump), without allocating.
    pub fn reset(&mut self) {
        // SAFETY: `raw` is a live instance owned by `self`.
        unsafe { bong_stretch_reset(self.raw.as_ptr()) }
    }

    /// Delay between input and output in frames (input + output latency).
    pub fn latency(&self) -> usize {
        // SAFETY: `raw` is a live instance; the getters only read.
        let (i, o) = unsafe {
            (
                bong_stretch_input_latency(self.raw.as_ptr()),
                bong_stretch_output_latency(self.raw.as_ptr()),
            )
        };
        (i.max(0) + o.max(0)) as usize
    }

    /// Frequency multiplier: 1.0 = unchanged, 0.5 = an octave down.
    pub fn set_transpose(&mut self, factor: f32) {
        let f = if factor.is_finite() && factor > 0.0 {
            factor
        } else {
            1.0
        };
        // SAFETY: `raw` is a live instance owned by `self`.
        unsafe { bong_stretch_set_transpose(self.raw.as_ptr(), f) }
    }

    /// Pitch-shifts interleaved stereo `input` into `output` of the same length.
    /// Realtime-safe (Signalsmith reserves its buffers when created).
    pub fn process(&mut self, input: &mut [f32], output: &mut [f32]) {
        let frames = (input.len().min(output.len()) / 2).min(c_int::MAX as usize) as c_int;
        // SAFETY: both buffers hold at least `frames` interleaved stereo frames and stay
        // borrowed for the duration of the call; Signalsmith reads `input` and writes `output`.
        unsafe {
            bong_stretch_process(
                self.raw.as_ptr(),
                input.as_mut_ptr(),
                frames,
                output.as_mut_ptr(),
                frames,
            )
        }
    }
}

impl Drop for Stretch {
    fn drop(&mut self) {
        // SAFETY: `raw` came from `bong_stretch_new` and is freed exactly once.
        unsafe { bong_stretch_free(self.raw.as_ptr()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dominant frequency by counting zero crossings (fine for a clean sine).
    fn frequency(signal: &[f32], rate: f64) -> f64 {
        let left: Vec<f32> = signal.iter().step_by(2).copied().collect();
        let mut crossings = Vec::new();
        for i in 1..left.len() {
            if left[i - 1] < 0.0 && left[i] >= 0.0 {
                let frac = f64::from(-left[i - 1] / (left[i] - left[i - 1]));
                crossings.push((i - 1) as f64 + frac);
            }
        }
        let (first, last) = (crossings[0], crossings[crossings.len() - 1]);
        (crossings.len() - 1) as f64 * rate / (last - first)
    }

    #[test]
    fn transposes_a_sine_by_the_given_factor() {
        let rate = 48_000u32;
        let mut s = Stretch::new(rate).expect("alloc");
        s.set_transpose(0.8);
        let frames = rate as usize * 2;
        let mut input: Vec<f32> = (0..frames)
            .flat_map(|n| {
                let v = 0.5 * (2.0 * std::f32::consts::PI * 500.0 * n as f32 / rate as f32).sin();
                [v, v]
            })
            .collect();
        let mut output = vec![0.0f32; input.len()];
        for (i, o) in input.chunks_mut(2 * 512).zip(output.chunks_mut(2 * 512)) {
            s.process(i, o);
        }
        let f = frequency(&output[output.len() / 2..], f64::from(rate));
        assert!((f - 400.0).abs() < 1.0, "measured {f} Hz");
    }
}
