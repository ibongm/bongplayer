//! M1 acceptance: offline render of a deck at 0 % pitch matches the source;
//! seek and hot-cue jumps land within 1 ms.

use std::path::PathBuf;
use std::sync::Arc;

use engine::deck::{Deck, LoadedTrack};
use engine::{decode_to_end, TrackBuffer};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// Plays the deck to the end one frame at a time; returns the interleaved output.
fn render_to_end(deck: &mut Deck, limit: usize) -> Vec<f32> {
    let mut out = Vec::new();
    let mut frame = [0.0f32; 2];
    deck.play();
    while out.len() / 2 < limit {
        deck.render(&mut frame);
        if deck.has_ended() {
            break;
        }
        out.extend_from_slice(&frame);
    }
    out
}

#[test]
fn same_rate_render_is_sample_exact() {
    let buf = decode_to_end(&fixture("tone_44100.wav")).expect("decode");
    let mut deck = Deck::new(44_100);
    deck.load(LoadedTrack::new(Arc::clone(&buf), 44_100));
    let out = render_to_end(&mut deck, 200_000);

    assert_eq!(out.len() / 2, 88_200, "rendered length");
    for (i, frame) in out.as_chunks::<2>().0.iter().enumerate() {
        let (l, r) = buf.frame(i as i64);
        assert_eq!((frame[0], frame[1]), (l, r), "frame {i}");
    }
}

#[test]
fn resampled_render_44k1_to_48k_matches_ideal_sine() {
    let buf = decode_to_end(&fixture("tone_44100.wav")).expect("decode");
    let mut deck = Deck::new(48_000);
    deck.load(LoadedTrack::new(buf, 48_000));
    let out = render_to_end(&mut deck, 200_000);

    let frames = out.len() / 2;
    assert!(
        frames.abs_diff(96_000) <= 1,
        "rendered {frames} frames, expected 96000 ± 1"
    );

    // Compare against 0.5·sin(2π·1000·t), skipping the kernel's edge (start/end of file).
    let edge = 64;
    let (mut err, mut sig) = (0.0f64, 0.0f64);
    for n in edge..frames - edge {
        let ideal = 0.5 * (2.0 * std::f64::consts::PI * 1000.0 * n as f64 / 48_000.0).sin();
        for ch in 0..2 {
            let e = f64::from(out[2 * n + ch]) - ideal;
            err += e * e;
            sig += ideal * ideal;
        }
    }
    let db = 10.0 * (err / sig).log10();
    println!("44.1 -> 48 kHz error: {db:.1} dB");
    assert!(db <= -80.0, "error {db:.1} dB, must be <= -80 dB");
}

/// A track whose samples encode their own frame index: left = index mod 32768, right =
/// index / 32768 (as 16-bit values).
fn index_track(rate: u32, frames: usize) -> Arc<TrackBuffer> {
    let mut s = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        s.push((i % 32_768) as f32 / 32_768.0);
        s.push((i / 32_768) as f32 / 32_768.0);
    }
    Arc::new(TrackBuffer::from_interleaved(rate, &s))
}

fn decode_index(l: f32, r: f32) -> i64 {
    (r * 32_768.0).round() as i64 * 32_768 + (l * 32_768.0).round() as i64
}

#[test]
fn seek_and_hot_cue_land_exactly_at_same_rate() {
    let mut deck = Deck::new(48_000);
    deck.load(LoadedTrack::new(index_track(48_000, 480_000), 48_000));
    deck.play();
    let mut frame = [0.0f32; 2];

    for &target in &[0u32, 1, 12_345, 100_000, 479_000] {
        deck.seek(f64::from(target));
        deck.render(&mut frame);
        assert_eq!(
            decode_index(frame[0], frame[1]),
            i64::from(target),
            "seek {target}"
        );
    }

    deck.seek(250_000.0);
    deck.set_hot_cue(3);
    deck.seek(10.0);
    let mut block = [0.0f32; 2 * 512];
    deck.render(&mut block);
    assert!(deck.jump_to_hot_cue(3));
    deck.render(&mut frame);
    assert_eq!(decode_index(frame[0], frame[1]), 250_000, "hot cue 4");

    deck.clear_hot_cue(3);
    assert!(!deck.jump_to_hot_cue(3), "cleared cue must not jump");
}

/// A slow ramp (one cycle every 40,000 frames) so interpolated values identify the position.
fn ramp_track(rate: u32, frames: usize) -> Arc<TrackBuffer> {
    let mut s = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        let v = ((i % 40_000) as f32 - 20_000.0) / 25_000.0;
        s.push(v);
        s.push(v);
    }
    Arc::new(TrackBuffer::from_interleaved(rate, &s))
}

#[test]
fn seek_and_hot_cue_within_1ms_when_resampling() {
    let one_ms_frames = 44.1;
    let mut deck = Deck::new(48_000);
    deck.load(LoadedTrack::new(ramp_track(44_100, 441_000), 48_000));
    deck.play();
    let mut frame = [0.0f32; 2];
    // Targets well inside a ramp cycle (away from the wrap at multiples of 40,000).
    let landed = |deck: &mut Deck, frame: &mut [f32; 2]| {
        deck.render(frame);
        f64::from(frame[0]) * 25_000.0 + 20_000.0
    };

    for &cycle_start in &[0.0, 120_000.0, 360_000.0] {
        let target = cycle_start + 15_000.5;
        deck.seek(target);
        let got = cycle_start + landed(&mut deck, &mut frame);
        assert!(
            (got - target).abs() <= one_ms_frames,
            "seek {target}: landed at {got}"
        );
    }

    deck.seek(200_000.0 + 7_777.0);
    deck.set_hot_cue(0);
    deck.seek(5_000.0);
    let mut block = [0.0f32; 2 * 1000];
    deck.render(&mut block);
    assert!(deck.jump_to_hot_cue(0));
    let got = 200_000.0 + landed(&mut deck, &mut frame);
    assert!(
        (got - 207_777.0).abs() <= one_ms_frames,
        "hot cue 1 landed at {got}"
    );
}
