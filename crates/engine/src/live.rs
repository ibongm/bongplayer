//! A live audio source (internet radio): a ring buffer the network thread writes into and a
//! deck reads from, holding only the last few seconds — a station can play for days without
//! the memory growing.
//!
//! Frames are addressed by their absolute index since the stream started. Writes and reads
//! are lock-free (one `AtomicU32` per packed 16-bit stereo frame, like `TrackBuffer`).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::track::{f32_to_i16, i16_to_f32};

#[inline]
fn pack(l: i16, r: i16) -> u32 {
    u32::from(l as u16) | (u32::from(r as u16) << 16)
}

#[inline]
fn unpack(v: u32) -> (i16, i16) {
    ((v & 0xFFFF) as u16 as i16, (v >> 16) as u16 as i16)
}

/// Seconds held by the ring.
pub const LIVE_SECONDS: u32 = 30;

pub struct LiveBuffer {
    sample_rate: AtomicU32,
    ring: Box<[AtomicU32]>,
    /// Frames written since the stream started.
    written: AtomicU64,
    /// The stream has stopped for good (station switched off / unloaded).
    closed: AtomicBool,
    /// What the station says it is playing ("Artist - Title"), and the connection state.
    title: Mutex<String>,
    state: Mutex<String>,
}

impl std::fmt::Debug for LiveBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveBuffer")
            .field("sample_rate", &self.sample_rate())
            .field("written", &self.written())
            .finish_non_exhaustive()
    }
}

impl LiveBuffer {
    /// A ring for `max_rate` (the highest sample rate it may need to hold).
    pub fn new(max_rate: u32) -> Self {
        let frames = (u64::from(max_rate.max(8_000)) * u64::from(LIVE_SECONDS)) as usize;
        Self {
            sample_rate: AtomicU32::new(max_rate),
            ring: (0..frames).map(|_| AtomicU32::new(0)).collect(),
            written: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            title: Mutex::new(String::new()),
            state: Mutex::new("connecting".into()),
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Relaxed)
    }

    /// Set by the writer once the stream's rate is known (before writing frames).
    pub fn set_sample_rate(&self, rate: u32) {
        self.sample_rate.store(rate.max(1), Ordering::Relaxed);
    }

    pub fn capacity(&self) -> u64 {
        self.ring.len() as u64
    }

    pub fn written(&self) -> u64 {
        self.written.load(Ordering::Acquire)
    }

    /// Appends interleaved stereo f32 frames (writer thread only).
    pub fn push(&self, samples: &[f32]) {
        let len = self.ring.len() as u64;
        let mut w = self.written.load(Ordering::Relaxed);
        for f in samples.as_chunks::<2>().0 {
            self.ring[(w % len) as usize]
                .store(pack(f32_to_i16(f[0]), f32_to_i16(f[1])), Ordering::Relaxed);
            w += 1;
        }
        self.written.store(w, Ordering::Release);
    }

    /// Frame `index` (absolute). Silence if it has not arrived yet or was overwritten.
    /// Realtime-safe.
    #[inline]
    pub fn frame(&self, index: i64) -> (f32, f32) {
        if index < 0 {
            return (0.0, 0.0);
        }
        let i = index as u64;
        let w = self.written();
        let len = self.ring.len() as u64;
        if i >= w || w - i > len {
            return (0.0, 0.0);
        }
        let (l, r) = unpack(self.ring[(i % len) as usize].load(Ordering::Relaxed));
        (i16_to_f32(l), i16_to_f32(r))
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub fn set_title(&self, title: &str) {
        if let Ok(mut t) = self.title.lock() {
            title.clone_into(&mut t);
        }
    }

    pub fn title(&self) -> String {
        self.title.lock().map(|t| t.clone()).unwrap_or_default()
    }

    /// Connection state for the screen: "connecting", "playing", "reconnecting in 4 s…", or
    /// an error.
    pub fn set_state(&self, state: &str) {
        if let Ok(mut s) = self.state.lock() {
            state.clone_into(&mut s);
        }
    }

    pub fn state(&self) -> String {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_keeps_only_the_last_seconds() {
        let b = LiveBuffer::new(8_000);
        let cap = b.capacity() as usize;
        let samples: Vec<f32> = (0..cap + 100)
            .flat_map(|i| [(i % 100) as f32 / 1000.0, 0.0])
            .collect();
        b.push(&samples);
        assert_eq!(b.written() as usize, cap + 100);
        assert_eq!(
            b.frame(10),
            (0.0, 0.0),
            "overwritten frames read as silence"
        );
        let i = cap + 50;
        let (l, _) = b.frame(i as i64);
        assert!((l - (i % 100) as f32 / 1000.0).abs() < 1e-4);
        assert_eq!(b.frame((cap + 100) as i64), (0.0, 0.0), "not yet arrived");
    }

    #[test]
    fn title_and_state() {
        let b = LiveBuffer::new(8_000);
        b.set_title("Artist - Song");
        b.set_state("playing");
        assert_eq!(b.title(), "Artist - Song");
        assert_eq!(b.state(), "playing");
    }
}
