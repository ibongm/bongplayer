//! Decoded audio of one track, kept in memory as 16-bit stereo.
//!
//! A background thread fills the buffer while the audio thread may already be reading it.
//! Storage is a table of fixed-size chunks; each frame is one `AtomicU32` (left in the low
//! 16 bits, right in the high 16 bits), so reads and writes need no locks and no `unsafe`.
//! Frames that are not decoded yet read as silence.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

/// log2 of the number of frames per chunk (65,536 frames ≈ 1.4 s at 48 kHz).
const CHUNK_SHIFT: u32 = 16;
const CHUNK_FRAMES: usize = 1 << CHUNK_SHIFT;
const CHUNK_MASK: u64 = (CHUNK_FRAMES as u64) - 1;

/// Longest track the buffer accepts, in seconds (6 hours). Longer files are cut off and
/// reported as truncated.
pub const MAX_TRACK_SECONDS: u64 = 6 * 60 * 60;

/// Converts an i16 sample to f32 in [-1, 1).
#[inline]
pub fn i16_to_f32(s: i16) -> f32 {
    f32::from(s) / 32768.0
}

/// Converts an f32 sample to i16 with rounding and clipping.
#[inline]
pub fn f32_to_i16(s: f32) -> i16 {
    // The cast saturates, so out-of-range values clip instead of wrapping.
    (s * 32768.0).round().clamp(-32768.0, 32767.0) as i16
}

#[inline]
fn pack(l: i16, r: i16) -> u32 {
    u32::from(l as u16) | (u32::from(r as u16) << 16)
}

#[inline]
fn unpack(v: u32) -> (i16, i16) {
    ((v & 0xFFFF) as u16 as i16, (v >> 16) as u16 as i16)
}

/// How decoding of a track ended (or that it is still running).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeState {
    Decoding,
    Finished,
    /// Decoding stopped early; the frames decoded so far remain playable.
    Failed(String),
}

pub struct TrackBuffer {
    sample_rate: u32,
    chunks: Box<[OnceLock<Box<[AtomicU32]>>]>,
    frames_ready: AtomicU64,
    done: AtomicBool,
    failure: OnceLock<String>,
    truncated: AtomicBool,
}

impl std::fmt::Debug for TrackBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TrackBuffer")
            .field("sample_rate", &self.sample_rate)
            .field("frames_ready", &self.frames_ready())
            .field("state", &self.state())
            .finish()
    }
}

impl TrackBuffer {
    /// An empty buffer that a decoder will fill.
    pub fn new(sample_rate: u32) -> Self {
        let max_frames = MAX_TRACK_SECONDS * u64::from(sample_rate.max(1));
        let n_chunks = max_frames.div_ceil(CHUNK_FRAMES as u64) as usize;
        Self {
            sample_rate,
            chunks: (0..n_chunks).map(|_| OnceLock::new()).collect(),
            frames_ready: AtomicU64::new(0),
            done: AtomicBool::new(false),
            failure: OnceLock::new(),
            truncated: AtomicBool::new(false),
        }
    }

    /// A finished buffer made from interleaved stereo f32 samples (tests and generated audio).
    pub fn from_interleaved(sample_rate: u32, samples: &[f32]) -> Self {
        let buf = Self::new(sample_rate);
        {
            let mut w = buf.writer();
            for &[l, r] in samples.as_chunks::<2>().0 {
                if !w.push(f32_to_i16(l), f32_to_i16(r)) {
                    break;
                }
            }
        }
        buf.finish();
        buf
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Number of frames that can be read right now.
    pub fn frames_ready(&self) -> u64 {
        self.frames_ready.load(Ordering::Acquire)
    }

    pub fn is_done(&self) -> bool {
        self.done.load(Ordering::Acquire)
    }

    /// Length in frames once decoding is done; `None` while still decoding.
    pub fn total_frames(&self) -> Option<u64> {
        self.is_done().then(|| self.frames_ready())
    }

    pub fn is_truncated(&self) -> bool {
        self.truncated.load(Ordering::Acquire)
    }

    pub fn state(&self) -> DecodeState {
        if !self.is_done() {
            DecodeState::Decoding
        } else if let Some(msg) = self.failure.get() {
            DecodeState::Failed(msg.clone())
        } else {
            DecodeState::Finished
        }
    }

    /// Reads one frame as f32. Frames outside the decoded range are silence.
    /// Realtime-safe: atomic loads only.
    #[inline]
    pub fn frame(&self, index: i64) -> (f32, f32) {
        let (l, r) = self.frame_i16(index);
        (i16_to_f32(l), i16_to_f32(r))
    }

    #[inline]
    pub fn frame_i16(&self, index: i64) -> (i16, i16) {
        if index < 0 {
            return (0, 0);
        }
        let i = index as u64;
        if i >= self.frames_ready() {
            return (0, 0);
        }
        let chunk = (i >> CHUNK_SHIFT) as usize;
        match self.chunks.get(chunk).and_then(OnceLock::get) {
            Some(c) => unpack(c[(i & CHUNK_MASK) as usize].load(Ordering::Relaxed)),
            None => (0, 0),
        }
    }

    /// Writer for the decoding thread. Only one writer may exist per buffer.
    pub fn writer(&self) -> TrackWriter<'_> {
        TrackWriter {
            buf: self,
            next: self.frames_ready(),
            unpublished: 0,
        }
    }

    /// Marks decoding as successfully finished.
    pub fn finish(&self) {
        self.done.store(true, Ordering::Release);
    }

    /// Marks decoding as stopped by an error; already decoded frames stay playable.
    pub fn fail(&self, message: impl Into<String>) {
        let _ = self.failure.set(message.into());
        self.done.store(true, Ordering::Release);
    }
}

/// Appends frames to a [`TrackBuffer`], publishing them in batches.
pub struct TrackWriter<'a> {
    buf: &'a TrackBuffer,
    next: u64,
    unpublished: u32,
}

impl TrackWriter<'_> {
    /// Appends one frame. Returns `false` when the buffer is full (track too long).
    pub fn push(&mut self, l: i16, r: i16) -> bool {
        let chunk_index = (self.next >> CHUNK_SHIFT) as usize;
        let Some(slot) = self.buf.chunks.get(chunk_index) else {
            self.buf.truncated.store(true, Ordering::Release);
            return false;
        };
        let chunk = slot.get_or_init(|| (0..CHUNK_FRAMES).map(|_| AtomicU32::new(0)).collect());
        chunk[(self.next & CHUNK_MASK) as usize].store(pack(l, r), Ordering::Relaxed);
        self.next += 1;
        self.unpublished += 1;
        if self.unpublished >= 4096 {
            self.flush();
        }
        true
    }

    /// Makes all pushed frames visible to readers.
    pub fn flush(&mut self) {
        self.buf.frames_ready.store(self.next, Ordering::Release);
        self.unpublished = 0;
    }
}

impl Drop for TrackWriter<'_> {
    fn drop(&mut self) {
        self.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_roundtrips_extremes() {
        for &(l, r) in &[(0, 0), (i16::MIN, i16::MAX), (-1, 1), (12345, -12345)] {
            assert_eq!(unpack(pack(l, r)), (l, r));
        }
    }

    #[test]
    fn frames_across_chunk_boundary_read_back() {
        let n = CHUNK_FRAMES + 10;
        let buf = TrackBuffer::new(48_000);
        {
            let mut w = buf.writer();
            for i in 0..n {
                assert!(w.push((i % 30000) as i16, -((i % 30000) as i16)));
            }
        }
        buf.finish();
        assert_eq!(buf.total_frames(), Some(n as u64));
        let i = CHUNK_FRAMES + 3;
        assert_eq!(
            buf.frame_i16(i as i64),
            ((i % 30000) as i16, -((i % 30000) as i16))
        );
    }

    #[test]
    fn unread_and_negative_frames_are_silence() {
        let buf = TrackBuffer::from_interleaved(44_100, &[0.5, -0.5]);
        assert_eq!(buf.frame(-1), (0.0, 0.0));
        assert_eq!(buf.frame(1), (0.0, 0.0));
        assert_eq!(buf.frame(0), (0.5, -0.5));
    }

    #[test]
    fn f32_to_i16_clips() {
        assert_eq!(f32_to_i16(2.0), i16::MAX);
        assert_eq!(f32_to_i16(-2.0), i16::MIN);
    }
}
