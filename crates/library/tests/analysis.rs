//! M3: BPM and key detection on synthetic music with known tempo and key, including the
//! tempos the old app got wrong (half/double confusion).

mod common;

use common::synth::{render_mono, Song};
use library::analysis::{detect_bpm, detect_key, Key};

fn song(bpm: f64, tonic: u8, minor: bool) -> Song {
    Song {
        bpm,
        tonic,
        minor,
        seconds: 40.0,
        rate: 44_100,
    }
}

#[test]
fn bpm_within_half_a_beat_per_minute() {
    // 82 (Come Together–like), 117 (Teen Spirit–like), 128 (house), 168 (Johnny B. Goode–like
    // rock'n'roll), 174 (drum & bass), plus slow and fast edges.
    let mut results = Vec::new();
    for bpm in [70.0, 82.0, 95.0, 117.0, 124.0, 128.0, 140.0, 168.0, 174.0] {
        let s = song(bpm, 9, true);
        let got = detect_bpm(&render_mono(&s), s.rate);
        println!("{bpm} BPM -> {got:?}");
        results.push((bpm, got));
    }
    for (bpm, got) in results {
        let got = got.expect("bpm");
        assert!((got - bpm).abs() <= 0.5, "{bpm} BPM detected as {got}");
    }
}

#[test]
fn silence_has_no_bpm_or_key() {
    let silence = vec![0.0f32; 44_100 * 20];
    assert_eq!(detect_bpm(&silence, 44_100), None);
    assert_eq!(detect_key(&silence, 44_100), None);
}

#[test]
fn key_detection_major_and_minor() {
    let cases = [
        (9, true),  // Am
        (0, false), // C
        (4, true),  // Em
        (7, false), // G
        (2, true),  // Dm
        (6, false), // F#
        (10, true), // Bbm
        (3, false), // Eb
    ];
    for (tonic, minor) in cases {
        let s = song(124.0, tonic, minor);
        let want = Key { tonic, minor };
        let got = detect_key(&render_mono(&s), s.rate).expect("key");
        println!(
            "{} ({}) -> {} ({})",
            want.name(),
            want.camelot(),
            got.name(),
            got.camelot()
        );
        assert_eq!(got, want, "{} detected as {}", want.name(), got.name());
    }
}
