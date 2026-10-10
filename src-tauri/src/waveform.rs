//! Waveform data for the decks, computed in Rust from the decoded track.
//!
//! 150 bins per second; each bin holds four bytes: overall peak, bass, mids, treble (0–255,
//! square-root scaled so quiet parts stay visible). The UI draws the scrolling and overview
//! waveforms from this.
//!
//! Binary layout (little endian): u32 bins-per-second × 1000, u32 bin count, then 4 bytes per bin.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use engine::TrackBuffer;

pub const BINS_PER_SECOND: f64 = 150.0;
/// Give up waiting for a track to finish decoding after this long without progress.
pub const DECODE_STALL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WaveState {
    Computing,
    Ready(Arc<Vec<u8>>),
    Failed(String),
}

/// Waveforms by track id.
#[derive(Debug, Default)]
pub struct WaveCache {
    map: Mutex<HashMap<i64, WaveState>>,
}

impl WaveCache {
    pub fn get(&self, track_id: i64) -> Option<WaveState> {
        crate::state::lock(&self.map).get(&track_id).cloned()
    }

    fn set(&self, track_id: i64, state: WaveState) {
        let mut map = crate::state::lock(&self.map);
        // Keep the cache small: waveforms of a few recent tracks.
        if map.len() > 16 && !map.contains_key(&track_id) {
            if let Some(&old) = map.keys().next() {
                map.remove(&old);
            }
        }
        map.insert(track_id, state);
    }

    /// Starts computing a track's waveform in the background (once it has decoded).
    pub fn start(self: &Arc<Self>, track_id: i64, buffer: Arc<TrackBuffer>) {
        if matches!(
            self.get(track_id),
            Some(WaveState::Ready(_) | WaveState::Computing)
        ) {
            return;
        }
        self.set(track_id, WaveState::Computing);
        let cache = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("bong-waveform".into())
            .spawn(move || {
                let state = match wait_decoded(&buffer, DECODE_STALL) {
                    Ok(()) => WaveState::Ready(Arc::new(compute(&buffer))),
                    Err(e) => WaveState::Failed(e),
                };
                cache.set(track_id, state);
            });
        if spawned.is_err() {
            self.set(
                track_id,
                WaveState::Failed("could not start the waveform task".into()),
            );
        }
    }
}

/// Waits until decoding is done; fails if it stops making progress for `stall`.
pub fn wait_decoded(buffer: &TrackBuffer, stall: Duration) -> Result<(), String> {
    let mut last = buffer.frames_ready();
    let mut since = Instant::now();
    while !buffer.is_done() {
        std::thread::sleep(Duration::from_millis(20));
        let now = buffer.frames_ready();
        if now != last {
            last = now;
            since = Instant::now();
        } else if since.elapsed() >= stall {
            return Err(format!(
                "decoding stopped responding (no progress for {} s)",
                stall.as_secs()
            ));
        }
    }
    Ok(())
}

fn scale(peak: f32) -> u8 {
    (peak.clamp(0.0, 1.0).sqrt() * 255.0).round() as u8
}

/// Computes the waveform bytes for a (decoded) track.
pub fn compute(buffer: &TrackBuffer) -> Vec<u8> {
    let rate = f64::from(buffer.sample_rate().max(1));
    let total = buffer.frames_ready();
    let per_bin = (rate / BINS_PER_SECOND).max(1.0);
    let bins = (total as f64 / per_bin).ceil() as usize;
    let mut out = Vec::with_capacity(8 + bins * 4);
    out.extend_from_slice(&((BINS_PER_SECOND * 1000.0) as u32).to_le_bytes());
    out.extend_from_slice(&(bins as u32).to_le_bytes());

    // One-pole band splits: bass below ~250 Hz, treble above ~3 kHz, mids in between.
    let a_low = 1.0 - (-2.0 * std::f64::consts::PI * 250.0 / rate).exp();
    let a_high = 1.0 - (-2.0 * std::f64::consts::PI * 3_000.0 / rate).exp();
    let (mut lp_low, mut lp_high) = (0.0f64, 0.0f64);
    let mut frame: u64 = 0;
    for b in 0..bins {
        let end = (((b + 1) as f64 * per_bin) as u64).min(total);
        let (mut peak, mut low, mut mid, mut high) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        while frame < end {
            let (l, r) = buffer.frame(frame as i64);
            let x = f64::from((l + r) * 0.5);
            lp_low += a_low * (x - lp_low);
            lp_high += a_high * (x - lp_high);
            let lo = lp_low;
            let hi = x - lp_high;
            let mi = x - lo - hi;
            peak = peak.max(l.abs().max(r.abs()));
            low = low.max(lo.abs() as f32);
            mid = mid.max(mi.abs() as f32);
            high = high.max(hi.abs() as f32);
            frame += 1;
        }
        out.extend_from_slice(&[scale(peak), scale(low), scale(mid), scale(high)]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f64, seconds: f64) -> TrackBuffer {
        let rate = 44_100.0;
        let s: Vec<f32> = (0..(rate * seconds) as usize)
            .flat_map(|i| {
                let v = (0.5 * (2.0 * std::f64::consts::PI * freq * i as f64 / rate).sin()) as f32;
                [v, v]
            })
            .collect();
        TrackBuffer::from_interleaved(44_100, &s)
    }

    fn bins(w: &[u8]) -> Vec<[u8; 4]> {
        w[8..]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| [c[0], c[1], c[2], c[3]])
            .collect()
    }

    #[test]
    fn header_and_bin_count() {
        let w = compute(&tone(440.0, 2.0));
        assert_eq!(u32::from_le_bytes([w[0], w[1], w[2], w[3]]), 150_000);
        assert_eq!(u32::from_le_bytes([w[4], w[5], w[6], w[7]]), 300);
        assert_eq!(w.len(), 8 + 300 * 4);
    }

    #[test]
    fn bands_follow_the_frequency() {
        let low = bins(&compute(&tone(60.0, 1.0)));
        let high = bins(&compute(&tone(8_000.0, 1.0)));
        let mid_bin = |v: &Vec<[u8; 4]>| v[v.len() / 2];
        let (l, h) = (mid_bin(&low), mid_bin(&high));
        assert!(l[1] > l[3] + 100, "60 Hz is bass: {l:?}");
        assert!(h[3] > h[1] + 100, "8 kHz is treble: {h:?}");
        // Peak of a 0.5 sine → sqrt(0.5) × 255 ≈ 180.
        assert!((175..=185).contains(&l[0]), "{l:?}");
    }

    #[test]
    fn a_stalled_decode_is_reported_not_waited_on_forever() {
        let buf = TrackBuffer::new(44_100); // never finished
        let started = Instant::now();
        let r = wait_decoded(&buf, Duration::from_millis(200));
        assert!(r.is_err_and(|e| e.contains("stopped responding")));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
