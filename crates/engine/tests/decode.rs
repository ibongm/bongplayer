//! M1 acceptance: decode mp3 / flac / wav / m4a / ogg; duration and sample rate correct.

use std::path::PathBuf;

use engine::{decode_to_end, DecodeError, DecodeState};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// Every fixture is a 2-second 1 kHz tone at -6 dBFS (amplitude 0.5), stereo.
fn check(name: &str, rate: u32, tolerance_frames: u64) {
    let buf = decode_to_end(&fixture(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
    assert_eq!(buf.state(), DecodeState::Finished, "{name}");
    assert_eq!(buf.sample_rate(), rate, "{name}: sample rate");

    let expected = u64::from(rate) * 2;
    let frames = buf.total_frames().expect("finished");
    let diff = frames.abs_diff(expected);
    println!("{name}: {frames} frames (expected {expected}, off by {diff})");
    assert!(
        diff <= tolerance_frames,
        "{name}: {frames} frames, expected {expected} (±{tolerance_frames}), off by {diff}"
    );

    // The content really is the tone: peak near 0.5 in the middle of the file.
    let mid = (frames / 2) as i64;
    let peak = (mid..mid + i64::from(rate) / 100)
        .map(|i| buf.frame(i).0.abs())
        .fold(0.0f32, f32::max);
    assert!((0.45..0.55).contains(&peak), "{name}: peak {peak}");
}

const ONE_MS_44K: u64 = 44;

#[test]
fn wav_44100_exact() {
    check("tone_44100.wav", 44_100, 0);
}

#[test]
fn wav_48000_exact() {
    check("tone_48000.wav", 48_000, 0);
}

#[test]
fn flac_44100_exact() {
    check("tone_44100.flac", 44_100, 0);
}

#[test]
fn flac_48000_exact() {
    check("tone_48000.flac", 48_000, 0);
}

#[test]
fn mp3_within_1ms() {
    check("tone_44100.mp3", 44_100, ONE_MS_44K);
}

#[test]
fn m4a_aac_within_1ms() {
    check("tone_44100.m4a", 44_100, ONE_MS_44K);
}

#[test]
fn ogg_vorbis_within_1ms() {
    check("tone_44100.ogg", 44_100, ONE_MS_44K);
}

#[test]
fn missing_file_is_an_error_not_a_panic() {
    match decode_to_end(&fixture("does_not_exist.mp3")) {
        Err(DecodeError::NotFound(_)) => {}
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[test]
fn corrupt_file_is_an_error_not_a_panic() {
    match decode_to_end(&fixture("corrupt.mp3")) {
        Err(DecodeError::Unsupported(..)) => {}
        Ok(buf) => assert!(
            matches!(buf.state(), DecodeState::Failed(_)) || buf.frames_ready() == 0,
            "corrupt file decoded as audio: {buf:?}"
        ),
        Err(other) => panic!("unexpected error kind: {other}"),
    }
}
