//! BPM and musical key detection.
//!
//! Both work on a mono excerpt (about a minute from the middle of the track), resampled down
//! to ~11 kHz, which is plenty for beats and harmony and keeps analysis fast.
//!
//! **BPM:** a spectral-flux onset curve (how much new sound starts in each 6 ms step) is
//! autocorrelated; each candidate tempo between 60 and 200 BPM is scored by the correlation at
//! 1, 2, 3 and 4 beat lengths, weighted by a broad preference around 120 BPM. The preference
//! only decides between equally strong half/double tempos, which is where the old app went
//! wrong (163 vs 82). The DJ can always override (manual BPM, TAP, ×2, ÷2).
//!
//! **Key:** a chromagram (energy per pitch class, 65 Hz – 2 kHz) is correlated with the
//! Krumhansl–Kessler major and minor key profiles in all 12 transpositions.

use std::path::Path;
use std::sync::Arc;

use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use serde::Serialize;

pub const MIN_BPM: f64 = 60.0;
pub const MAX_BPM: f64 = 200.0;
/// Seconds of audio analysed.
pub const EXCERPT_SECONDS: f64 = 60.0;

const TARGET_RATE: f64 = 11_025.0;
const FLUX_WINDOW: usize = 512;
const FLUX_HOP: usize = 64;
const CHROMA_WINDOW: usize = 4096;
const CHROMA_HOP: usize = 2048;

/// A musical key: tonic pitch class (0 = C … 11 = B) and mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub tonic: u8,
    pub minor: bool,
}

const NAMES: [&str; 12] = [
    "C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

impl Key {
    /// Camelot wheel code, e.g. "8A" for A minor, "8B" for C major.
    pub fn camelot(self) -> String {
        let pc = u32::from(self.tonic % 12);
        let (n, letter) = if self.minor {
            ((7 * pc + 4) % 12 + 1, 'A')
        } else {
            ((7 * pc + 7) % 12 + 1, 'B')
        };
        format!("{n}{letter}")
    }

    /// Musical name, e.g. "Am", "F#", "Bbm".
    pub fn name(self) -> String {
        let n = NAMES[usize::from(self.tonic % 12)];
        if self.minor {
            format!("{n}m")
        } else {
            n.to_string()
        }
    }

    /// Parses a Camelot code ("8A") or a key name ("Am", "C#", "Bbm", "F# minor").
    pub fn parse(s: &str) -> Option<Self> {
        let t = s.trim();
        let upper = t.to_uppercase();
        if upper.ends_with(['A', 'B']) && upper[..upper.len() - 1].parse::<u32>().is_ok() {
            return (0u8..12)
                .flat_map(|tonic| [false, true].map(|minor| Key { tonic, minor }))
                .find(|k| k.camelot() == upper);
        }
        let lower = t.to_lowercase();
        let minor = lower.ends_with('m') && !lower.ends_with("maj") || lower.contains("min");
        let root = lower
            .trim_end_matches("minor")
            .trim_end_matches("major")
            .trim_end_matches("min")
            .trim_end_matches("maj")
            .trim_end_matches('m')
            .trim();
        let mut chars = root.chars();
        let base = match chars.next()? {
            'c' => 0,
            'd' => 2,
            'e' => 4,
            'f' => 5,
            'g' => 7,
            'a' => 9,
            'b' => 11,
            _ => return None,
        };
        let shift: i32 = match chars.next() {
            Some('#') | Some('♯') => 1,
            Some('b') | Some('♭') => -1,
            None => 0,
            _ => return None,
        };
        Some(Key {
            tonic: (base + shift).rem_euclid(12) as u8,
            minor,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub bpm: Option<f64>,
    pub key: Option<Key>,
}

/// Averages blocks of samples to bring the rate down to about 11 kHz.
fn downsample(samples: &[f32], rate: u32) -> (Vec<f32>, f64) {
    let factor = ((f64::from(rate) / TARGET_RATE).round() as usize).max(1);
    let out = samples
        .chunks(factor)
        .map(|c| c.iter().sum::<f32>() / c.len() as f32)
        .collect();
    (out, f64::from(rate) / factor as f64)
}

fn hann(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| {
            let x = std::f32::consts::PI * 2.0 * i as f32 / n as f32;
            0.5 - 0.5 * x.cos()
        })
        .collect()
}

/// Magnitude spectra of successive windows.
fn spectra(
    signal: &[f32],
    window: usize,
    hop: usize,
    fft: &Arc<dyn Fft<f32>>,
    mut each: impl FnMut(&[f32]),
) {
    let win = hann(window);
    let mut buf = vec![Complex32::new(0.0, 0.0); window];
    let mut mags = vec![0.0f32; window / 2];
    let mut start = 0;
    while start + window <= signal.len() {
        for (i, b) in buf.iter_mut().enumerate() {
            *b = Complex32::new(signal[start + i] * win[i], 0.0);
        }
        fft.process(&mut buf);
        for (m, c) in mags.iter_mut().zip(&buf) {
            *m = c.norm();
        }
        each(&mags);
        start += hop;
    }
}

/// Removes the slowly varying level (≈ 0.4 s moving average) and keeps only rises.
fn detrend(env: &[f32], frame_rate: f64) -> Vec<f32> {
    let half = ((0.2 * frame_rate) as usize).max(1);
    let mut prefix = vec![0.0f64; env.len() + 1];
    for (i, v) in env.iter().enumerate() {
        prefix[i + 1] = prefix[i] + f64::from(*v);
    }
    (0..env.len())
        .map(|i| {
            let lo = i.saturating_sub(half);
            let hi = (i + half + 1).min(env.len());
            let mean = (prefix[hi] - prefix[lo]) / (hi - lo) as f64;
            (f64::from(env[i]) - mean).max(0.0) as f32
        })
        .collect()
}

/// Onset strength per hop (spectral flux on log magnitudes): (full band up to 5 kHz,
/// low band below 150 Hz — the kick drum and bass).
fn onset_envelopes(
    signal: &[f32],
    rate: f64,
    planner: &mut FftPlanner<f32>,
) -> (Vec<f32>, Vec<f32>) {
    let fft = planner.plan_fft_forward(FLUX_WINDOW);
    let bin = |hz: f64| ((hz / rate * FLUX_WINDOW as f64) as usize).min(FLUX_WINDOW / 2);
    let (max_bin, low_bin) = (bin(5_000.0), bin(150.0).max(2));
    let mut prev = vec![0.0f32; FLUX_WINDOW / 2];
    let (mut full, mut low) = (Vec::new(), Vec::new());
    let mut first = true;
    spectra(signal, FLUX_WINDOW, FLUX_HOP, &fft, |mags| {
        let (mut f, mut l) = (0.0, 0.0);
        for (i, &m) in mags.iter().enumerate().take(max_bin) {
            let v = (1.0 + 1000.0 * m).ln();
            if !first {
                let rise = (v - prev[i]).max(0.0);
                f += rise;
                if i < low_bin {
                    l += rise;
                }
            }
            prev[i] = v;
        }
        first = false;
        full.push(f);
        low.push(l);
    });
    let frame_rate = rate / FLUX_HOP as f64;
    (detrend(&full, frame_rate), detrend(&low, frame_rate))
}

fn autocorrelation(env: &[f32], max_lag: usize) -> Vec<f64> {
    let n = env.len();
    (0..=max_lag.min(n.saturating_sub(1)))
        .map(|lag| {
            let s: f64 = env[..n - lag]
                .iter()
                .zip(&env[lag..])
                .map(|(a, b)| f64::from(*a) * f64::from(*b))
                .sum();
            s / (n - lag) as f64
        })
        .collect()
}

fn interp(acf: &[f64], lag: f64) -> f64 {
    let i = lag.floor() as usize;
    if i + 1 >= acf.len() {
        return 0.0;
    }
    let f = lag - i as f64;
    acf[i] * (1.0 - f) + acf[i + 1] * f
}

/// Mean correlation at 1…`beats` beat lengths for a tempo.
fn periodicity(acf: &[f64], frame_rate: f64, bpm: f64, beats: usize) -> f64 {
    let lag = 60.0 / bpm * frame_rate;
    (1..=beats)
        .map(|k| interp(acf, lag * k as f64))
        .sum::<f64>()
        / beats as f64
}

/// Estimated tempo in BPM, or `None` when there is no clear beat.
pub fn detect_bpm(samples: &[f32], rate: u32) -> Option<f64> {
    let (signal, sr) = downsample(samples, rate);
    let mut planner = FftPlanner::new();
    let (env, low_env) = onset_envelopes(&signal, sr, &mut planner);
    let frame_rate = sr / FLUX_HOP as f64;
    if env.len() < (frame_rate * 8.0) as usize {
        return None;
    }
    // Lags up to 8 beats at the slowest tempo (8 beats are used for fine refinement).
    let max_lag = (8.0 * 60.0 / MIN_BPM * frame_rate).ceil() as usize + 2;
    let acf = autocorrelation(&env, max_lag);
    let low_acf = autocorrelation(&low_env, max_lag);
    if acf.first().copied().unwrap_or(0.0) <= 0.0 {
        return None;
    }
    let prior = |bpm: f64| -> f64 {
        let octaves = (bpm / 120.0).log2();
        (-0.5 * (octaves / 0.9).powi(2)).exp()
    };

    // 1. The strongest periodicity overall (with a mild preference around 120 BPM).
    let mut best = (0.0, f64::MIN);
    let mut bpm = MIN_BPM;
    while bpm <= MAX_BPM {
        let s = periodicity(&acf, frame_rate, bpm, 4) * prior(bpm);
        if s > best.1 {
            best = (bpm, s);
        }
        bpm += 0.05;
    }
    // Reject flat material (no periodicity clearly above the average correlation).
    let mean_acf = acf[1..].iter().sum::<f64>() / (acf.len() - 1) as f64;
    if periodicity(&acf, frame_rate, best.0, 4) < mean_acf * 1.15 {
        return None;
    }

    // 2. Half / double decision: the beat is the fastest level the kick drum and bass
    //    repeat on. Hi-hats on the off-beats or a snare on 2 and 4 must not move it.
    let low_energy = low_acf.first().copied().unwrap_or(0.0);
    let mut chosen = best.0;
    if low_energy > 0.0 {
        let candidates: Vec<f64> = [best.0 / 2.0, best.0, best.0 * 2.0]
            .into_iter()
            .filter(|b| (MIN_BPM..=MAX_BPM).contains(b))
            .collect();
        let strength: Vec<f64> = candidates
            .iter()
            .map(|&b| periodicity(&low_acf, frame_rate, b, 4))
            .collect();
        let strongest = strength.iter().copied().fold(f64::MIN, f64::max);
        if strongest > 0.0 {
            // Fastest candidate whose low-band periodicity is close to the strongest.
            if let Some((b, _)) = candidates
                .iter()
                .zip(&strength)
                .filter(|(_, s)| **s >= 0.75 * strongest)
                .max_by(|a, b| a.0.total_cmp(b.0))
            {
                chosen = *b;
            }
        }
    }

    // 3. Refine to 0.01 BPM using 8 beats of correlation.
    let mut fine = (chosen, f64::MIN);
    let mut b = chosen - 1.0;
    while b <= chosen + 1.0 {
        let s = periodicity(&acf, frame_rate, b, 8);
        if s > fine.1 {
            fine = (b, s);
        }
        b += 0.01;
    }
    Some((fine.0 * 100.0).round() / 100.0)
}

const MAJOR_PROFILE: [f64; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE: [f64; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

fn correlation(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    let ma = a.iter().sum::<f64>() / 12.0;
    let mb = b.iter().sum::<f64>() / 12.0;
    let (mut num, mut da, mut db) = (0.0, 0.0, 0.0);
    for i in 0..12 {
        let x = a[i] - ma;
        let y = b[i] - mb;
        num += x * y;
        da += x * x;
        db += y * y;
    }
    if da <= 0.0 || db <= 0.0 {
        0.0
    } else {
        num / (da * db).sqrt()
    }
}

/// Energy per pitch class (C = 0).
pub fn chromagram(samples: &[f32], rate: u32) -> [f64; 12] {
    let (signal, sr) = downsample(samples, rate);
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(CHROMA_WINDOW);
    let bin_hz = sr / CHROMA_WINDOW as f64;
    let lo = (65.0 / bin_hz).ceil() as usize;
    let hi = ((2_000.0 / bin_hz) as usize).min(CHROMA_WINDOW / 2 - 1);
    // Precompute each bin's pitch-class weights (triangular, ±0.5 semitone).
    let mapping: Vec<(usize, usize, f64)> = (lo..=hi)
        .filter_map(|b| {
            let f = b as f64 * bin_hz;
            let midi = 69.0 + 12.0 * (f / 440.0).log2();
            let nearest = midi.round();
            let w = 1.0 - (midi - nearest).abs() * 2.0;
            (w > 0.0).then(|| (b, (nearest as i64).rem_euclid(12) as usize, w))
        })
        .collect();
    let mut chroma = [0.0f64; 12];
    spectra(&signal, CHROMA_WINDOW, CHROMA_HOP, &fft, |mags| {
        let mut frame = [0.0f64; 12];
        for &(b, pc, w) in &mapping {
            frame[pc] += f64::from(mags[b]).sqrt() * w;
        }
        // Normalise per frame so loud passages do not dominate.
        let total: f64 = frame.iter().sum();
        if total > 0.0 {
            for (c, f) in chroma.iter_mut().zip(frame) {
                *c += f / total;
            }
        }
    });
    chroma
}

/// Estimated key, or `None` for silence / unpitched material.
pub fn detect_key(samples: &[f32], rate: u32) -> Option<Key> {
    let chroma = chromagram(samples, rate);
    if chroma.iter().sum::<f64>() <= 0.0 {
        return None;
    }
    let mut best = (
        Key {
            tonic: 0,
            minor: false,
        },
        f64::MIN,
    );
    for tonic in 0..12u8 {
        for (minor, profile) in [(false, &MAJOR_PROFILE), (true, &MINOR_PROFILE)] {
            let mut rotated = [0.0; 12];
            for (i, r) in rotated.iter_mut().enumerate() {
                *r = profile[(i + 12 - usize::from(tonic)) % 12];
            }
            let c = correlation(&chroma, &rotated);
            if c > best.1 {
                best = (Key { tonic, minor }, c);
            }
        }
    }
    (best.1 > 0.3).then_some(best.0)
}

pub fn analyze_samples(samples: &[f32], rate: u32) -> Analysis {
    Analysis {
        bpm: detect_bpm(samples, rate),
        key: detect_key(samples, rate),
    }
}

/// Decodes an excerpt of the file and analyses it.
pub fn analyze_file(path: &Path) -> Result<Analysis, engine::DecodeError> {
    // Probe the length first: long tracks are analysed from 30 % in (past the intro).
    let probe = engine::decode_excerpt(path, 0.0, 0.0)?;
    let long = probe
        .total_frames
        .is_some_and(|t| t as f64 / f64::from(probe.sample_rate) > EXCERPT_SECONDS * 2.0);
    let start = if long { 0.3 } else { 0.0 };
    let ex = engine::decode_excerpt(path, start, EXCERPT_SECONDS)?;
    Ok(analyze_samples(&ex.samples, ex.sample_rate))
}

/// Halves or doubles `bpm` until it lies in `[low, low * 2)` (manual "fold" helper).
pub fn fold_bpm(bpm: f64, low: f64) -> f64 {
    let mut b = bpm;
    if !(b.is_finite() && b > 0.0 && low > 0.0) {
        return bpm;
    }
    while b < low {
        b *= 2.0;
    }
    while b >= low * 2.0 {
        b /= 2.0;
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camelot_codes() {
        let am = Key {
            tonic: 9,
            minor: true,
        };
        assert_eq!(am.camelot(), "8A");
        assert_eq!(
            Key {
                tonic: 0,
                minor: false
            }
            .camelot(),
            "8B"
        );
        assert_eq!(
            Key {
                tonic: 7,
                minor: false
            }
            .camelot(),
            "9B"
        );
        assert_eq!(
            Key {
                tonic: 4,
                minor: true
            }
            .camelot(),
            "9A"
        );
        assert_eq!(
            Key {
                tonic: 5,
                minor: false
            }
            .camelot(),
            "7B"
        );
        assert_eq!(
            Key {
                tonic: 2,
                minor: true
            }
            .camelot(),
            "7A"
        );
        assert_eq!(am.name(), "Am");
    }

    #[test]
    fn keys_parse_from_names_and_camelot() {
        for tonic in 0..12 {
            for minor in [false, true] {
                let k = Key { tonic, minor };
                assert_eq!(Key::parse(&k.camelot()), Some(k), "{}", k.camelot());
                assert_eq!(Key::parse(&k.name()), Some(k), "{}", k.name());
            }
        }
        assert_eq!(
            Key::parse("F# minor"),
            Some(Key {
                tonic: 6,
                minor: true
            })
        );
        assert_eq!(Key::parse("x"), None);
    }

    #[test]
    fn folding() {
        assert_eq!(fold_bpm(163.0, 70.0), 81.5);
        assert_eq!(fold_bpm(41.0, 70.0), 82.0);
        assert_eq!(fold_bpm(128.0, 70.0), 128.0);
    }
}
