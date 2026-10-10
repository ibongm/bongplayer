//! Sampler: 8 pads of short sounds (jingles, horns, drops). Pads are mixed after the deck
//! channels, faders and crossfader — never through a deck fader — and only the master level
//! and the limiter apply to them. While a pad plays the music is ducked (see the mixer).

use std::sync::Arc;

use crate::eq::db_to_gain;
use crate::track::TrackBuffer;

pub const PADS: usize = 8;
/// Longest sample a pad accepts (memory: ≈ 11 MB per pad at 48 kHz).
pub const MAX_SAMPLE_SECONDS: f64 = 30.0;
/// Choke groups 1…4; 0 = none.
pub const CHOKE_GROUPS: u8 = 4;
/// A pad cut off by its choke group fades out over this long (no click).
const CHOKE_FADE_SECONDS: f64 = 0.005;

/// A decoded sample, stereo, at its file's sample rate.
#[derive(Debug)]
pub struct Sample {
    frames: Vec<f32>,
    rate: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SampleError {
    TooLong { seconds: f64 },
    Empty,
}

impl std::fmt::Display for SampleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLong { seconds } => write!(
                f,
                "the sound is {seconds:.0} s long; pads take sounds up to {MAX_SAMPLE_SECONDS:.0} s"
            ),
            Self::Empty => f.write_str("the sound file has no audio"),
        }
    }
}

impl std::error::Error for SampleError {}

impl Sample {
    /// Copies a fully decoded track into a pad sample. Allocates: call off the audio thread.
    pub fn from_track(track: &TrackBuffer) -> Result<Self, SampleError> {
        let n = track.frames_ready();
        let rate = track.sample_rate().max(1);
        let seconds = n as f64 / f64::from(rate);
        if n == 0 {
            return Err(SampleError::Empty);
        }
        if seconds > MAX_SAMPLE_SECONDS {
            return Err(SampleError::TooLong { seconds });
        }
        let mut frames = Vec::with_capacity(2 * n as usize);
        for i in 0..n as i64 {
            let (l, r) = track.frame(i);
            frames.push(l);
            frames.push(r);
        }
        Ok(Self { frames, rate })
    }

    /// From interleaved stereo samples (tests).
    pub fn from_interleaved(rate: u32, samples: &[f32]) -> Self {
        Self {
            frames: samples[..samples.len() & !1].to_vec(),
            rate: rate.max(1),
        }
    }

    pub fn frames(&self) -> usize {
        self.frames.len() / 2
    }

    pub fn seconds(&self) -> f64 {
        self.frames() as f64 / f64::from(self.rate)
    }

    /// Linear interpolation between frames (samples are short sounds; good enough here).
    #[inline]
    fn read(&self, pos: f64) -> (f32, f32) {
        let i = pos as usize;
        let t = (pos - i as f64) as f32;
        let at = |k: usize| -> (f32, f32) {
            match self.frames.get(2 * k..2 * k + 2) {
                Some(f) => (f[0], f[1]),
                None => (0.0, 0.0),
            }
        };
        let (l0, r0) = at(i);
        let (l1, r1) = at(i + 1);
        (l0 + (l1 - l0) * t, r0 + (r1 - r0) * t)
    }
}

#[derive(Debug, Default)]
struct Pad {
    sample: Option<Arc<Sample>>,
    pos: f64,
    playing: bool,
    gain: f32,
    choke: u8,
    /// Frames left of a choke fade-out (0 = not fading).
    fade_left: u32,
}

#[derive(Debug)]
pub struct Sampler {
    pads: [Pad; PADS],
    out_rate: u32,
    fade_frames: u32,
}

impl Sampler {
    pub fn new(out_rate: u32) -> Self {
        let mut s = Self {
            pads: Default::default(),
            out_rate: out_rate.max(1),
            fade_frames: 1,
        };
        s.set_out_rate(out_rate);
        for p in &mut s.pads {
            p.gain = 1.0;
        }
        s
    }

    pub fn set_out_rate(&mut self, out_rate: u32) {
        self.out_rate = out_rate.max(1);
        self.fade_frames = ((CHOKE_FADE_SECONDS * f64::from(self.out_rate)) as u32).max(1);
    }

    /// Puts a sample on a pad (None clears it); returns the old one so the caller can free it
    /// off the audio thread.
    pub fn load(&mut self, pad: usize, sample: Option<Arc<Sample>>) -> Option<Arc<Sample>> {
        let p = self.pads.get_mut(pad)?;
        p.playing = false;
        p.pos = 0.0;
        p.fade_left = 0;
        std::mem::replace(&mut p.sample, sample)
    }

    /// Plays a pad from the start (again, if it is already playing). Pads in the same choke
    /// group are faded out.
    pub fn trigger(&mut self, pad: usize) {
        let Some(group) = self.pads.get(pad).map(|p| p.choke) else {
            return;
        };
        if self.pads[pad].sample.is_none() {
            return;
        }
        if group != 0 {
            let fade = self.fade_frames;
            for (i, other) in self.pads.iter_mut().enumerate() {
                if i != pad && other.choke == group && other.playing && other.fade_left == 0 {
                    other.fade_left = fade;
                }
            }
        }
        let p = &mut self.pads[pad];
        p.pos = 0.0;
        p.playing = true;
        p.fade_left = 0;
    }

    pub fn stop(&mut self, pad: usize) {
        if let Some(p) = self.pads.get_mut(pad) {
            if p.playing && p.fade_left == 0 {
                p.fade_left = self.fade_frames;
            }
        }
    }

    pub fn stop_all(&mut self) {
        for i in 0..PADS {
            self.stop(i);
        }
    }

    /// Pad gain in dB (−∞ … +6 dB).
    pub fn set_gain_db(&mut self, pad: usize, db: f32) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.gain = db_to_gain(if db.is_nan() { 0.0 } else { db.min(6.0) });
        }
    }

    /// Choke group 1…4, or 0 for none.
    pub fn set_choke(&mut self, pad: usize, group: u8) {
        if let Some(p) = self.pads.get_mut(pad) {
            p.choke = group.min(CHOKE_GROUPS);
        }
    }

    /// Bit `i` set = pad `i` is playing.
    pub fn playing_mask(&self) -> u8 {
        self.pads
            .iter()
            .enumerate()
            .filter(|(_, p)| p.playing)
            .fold(0, |m, (i, _)| m | (1 << i))
    }

    pub fn any_playing(&self) -> bool {
        self.pads.iter().any(|p| p.playing)
    }

    /// Adds the playing pads into `out` (interleaved stereo). Realtime-safe.
    pub fn render_add(&mut self, out: &mut [f32]) {
        let fade_frames = self.fade_frames as f32;
        let out_rate = f64::from(self.out_rate);
        for p in &mut self.pads {
            if !p.playing {
                continue;
            }
            let Some(sample) = p.sample.as_deref() else {
                p.playing = false;
                continue;
            };
            let step = f64::from(sample.rate) / out_rate;
            let end = sample.frames() as f64;
            for frame in out.as_chunks_mut::<2>().0 {
                if p.pos >= end {
                    p.playing = false;
                    break;
                }
                let mut g = p.gain;
                if p.fade_left > 0 {
                    g *= p.fade_left as f32 / fade_frames;
                    p.fade_left -= 1;
                    if p.fade_left == 0 {
                        p.playing = false;
                        break;
                    }
                }
                let (l, r) = sample.read(p.pos);
                frame[0] += l * g;
                frame[1] += r * g;
                p.pos += step;
            }
            if p.pos >= end {
                p.playing = false;
            }
        }
    }
}
