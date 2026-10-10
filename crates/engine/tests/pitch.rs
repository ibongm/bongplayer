//! M2 acceptance: ±8 / 16 / 50 % pitch changes speed correctly; key lock keeps pitch within
//! 5 cents; scrub input (jog) produces audio that follows position, forward and reverse.

use std::sync::Arc;

use engine::deck::{Deck, LoadedTrack};
use engine::TrackBuffer;

const SR: u32 = 48_000;

fn sine_track(freq: f64, seconds: f64) -> Arc<TrackBuffer> {
    let frames = (f64::from(SR) * seconds) as usize;
    let s: Vec<f32> = (0..frames)
        .flat_map(|n| {
            let v =
                (0.5 * (2.0 * std::f64::consts::PI * freq * n as f64 / f64::from(SR)).sin()) as f32;
            [v, v]
        })
        .collect();
    Arc::new(TrackBuffer::from_interleaved(SR, &s))
}

fn deck_with(track: Arc<TrackBuffer>) -> Deck {
    let mut deck = Deck::new(SR);
    deck.load(LoadedTrack::new(track, SR));
    deck
}

fn render(deck: &mut Deck, frames: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; 2 * frames];
    for block in out.chunks_mut(2 * 480) {
        deck.render(block);
    }
    out
}

/// Frequency of a clean sine (left channel) from interpolated zero crossings.
fn frequency(signal: &[f32]) -> f64 {
    let left: Vec<f32> = signal.iter().step_by(2).copied().collect();
    let mut crossings = Vec::new();
    for i in 1..left.len() {
        if left[i - 1] < 0.0 && left[i] >= 0.0 {
            let frac = f64::from(-left[i - 1] / (left[i] - left[i - 1]));
            crossings.push((i - 1) as f64 + frac);
        }
    }
    assert!(crossings.len() > 10, "no signal");
    let (first, last) = (crossings[0], crossings[crossings.len() - 1]);
    (crossings.len() - 1) as f64 * f64::from(SR) / (last - first)
}

fn cents(measured: f64, reference: f64) -> f64 {
    1200.0 * (measured / reference).log2()
}

#[test]
fn pitch_changes_speed_and_pitch_at_every_range() {
    for range in [0.08, 0.16, 0.50] {
        for sign in [-1.0, 1.0] {
            let pitch = sign * range;
            let mut deck = deck_with(sine_track(440.0, 4.0));
            deck.set_pitch_range(range);
            deck.set_pitch(pitch);
            deck.play();
            let out = render(&mut deck, SR as usize);
            let advanced = deck.position();
            let expected = f64::from(SR) * (1.0 + pitch);
            assert!(
                (advanced - expected).abs() < 1.0,
                "range {range} pitch {pitch:+}: moved {advanced} frames, expected {expected}"
            );
            let f = frequency(&out[SR as usize / 4..]);
            let want = 440.0 * (1.0 + pitch);
            assert!(
                cents(f, want).abs() < 2.0,
                "pitch {pitch:+}: {f:.2} Hz, expected {want:.2} Hz"
            );
        }
    }
}

#[test]
fn pitch_is_clamped_to_the_range() {
    let mut deck = Deck::new(SR);
    deck.set_pitch_range(0.08);
    deck.set_pitch(0.3);
    assert_eq!(deck.pitch(), 0.08);
    deck.set_pitch_range(0.5);
    deck.set_pitch(0.3);
    assert_eq!(deck.pitch(), 0.3);
    deck.set_pitch_range(0.16);
    assert_eq!(deck.pitch(), 0.16, "narrowing the range clamps the pitch");
}

#[test]
fn key_lock_keeps_pitch_within_5_cents() {
    for pitch in [-0.5, -0.16, -0.08, 0.0, 0.08, 0.16, 0.5] {
        let mut deck = deck_with(sine_track(440.0, 8.0));
        deck.set_pitch_range(0.5);
        deck.set_pitch(pitch);
        deck.set_key_lock(true);
        deck.play();
        let out = render(&mut deck, 2 * SR as usize);
        let f = frequency(&out[SR as usize / 2..]);
        let c = cents(f, 440.0);
        println!("key lock, pitch {pitch:+}: {f:.3} Hz ({c:+.2} cents)");
        assert!(
            c.abs() <= 5.0,
            "pitch {pitch:+}: {f:.3} Hz is {c:+.2} cents off"
        );
        // Tempo still changes.
        let moved = deck.position();
        let expected = 2.0 * f64::from(SR) * (1.0 + pitch);
        assert!(
            (moved - expected).abs() < 0.01 * f64::from(SR),
            "pitch {pitch:+}: audible position {moved}, expected about {expected}"
        );
    }
}

#[test]
fn key_lock_output_is_on_time() {
    // Silence with a 1 kHz burst at 2.0 s. With key lock and +8 % tempo it must be heard at
    // 2.0 / 1.08 s, and the deck must report that position when it is heard.
    let frames = SR as usize * 4;
    let burst_at = SR as usize * 2;
    let s: Vec<f32> = (0..frames)
        .flat_map(|n| {
            let v = if n >= burst_at {
                (0.5 * (2.0 * std::f64::consts::PI * 1000.0 * n as f64 / f64::from(SR)).sin())
                    as f32
            } else {
                0.0
            };
            [v, v]
        })
        .collect();
    let mut deck = deck_with(Arc::new(TrackBuffer::from_interleaved(SR, &s)));
    deck.set_pitch(0.08);
    deck.set_key_lock(true);
    deck.play();
    let out = render(&mut deck, 3 * SR as usize);
    let heard = out
        .iter()
        .step_by(2)
        .position(|s| s.abs() > 0.1)
        .expect("burst heard");
    let expected = burst_at as f64 / 1.08;
    let error_ms = (heard as f64 - expected) / f64::from(SR) * 1000.0;
    println!("key lock timing error: {error_ms:+.1} ms");
    assert!(error_ms.abs() <= 20.0, "burst heard {error_ms:+.1} ms off");
}

/// Ramp that encodes position within a 50,000-frame cycle at ~0.8-frame resolution after
/// 16-bit storage. Decode with `cycle_start + offset(value)`.
const CYCLE: f64 = 50_000.0;

fn ramp_track(frames: usize) -> Arc<TrackBuffer> {
    let s: Vec<f32> = (0..frames)
        .flat_map(|n| {
            let v = ((n as f64 % CYCLE) - CYCLE / 2.0) / (CYCLE / 2.0) * 0.99;
            [v as f32, v as f32]
        })
        .collect();
    Arc::new(TrackBuffer::from_interleaved(SR, &s))
}

/// Frame offset inside the cycle encoded by a sample value.
fn offset(v: f32) -> f64 {
    f64::from(v) / 0.99 * (CYCLE / 2.0) + CYCLE / 2.0
}

#[test]
fn scratch_follows_the_hand_forward_and_backward() {
    // All positions stay inside the cycle 200,000 … 250,000.
    let base = 200_000.0;
    let mut deck = deck_with(ramp_track(SR as usize * 10));
    deck.seek(220_000.0);
    deck.scratch_start();
    assert!(deck.is_scratching());

    // Push forward by 4,800 frames (0.1 s of audio) and let the glide settle.
    deck.scratch_move(4_800.0);
    let fwd = render(&mut deck, 4_800);
    assert!(
        (deck.position() - 224_800.0).abs() < 2.0,
        "forward: at {}",
        deck.position()
    );
    // The audio walks through the track forward.
    let first = base + offset(fwd[0]);
    let last = base + offset(fwd[fwd.len() - 2]);
    assert!(last > first + 4_000.0, "forward audio {first} -> {last}");

    // Pull back by 9,600 frames: the record plays backwards.
    deck.scratch_move(-9_600.0);
    let back = render(&mut deck, 9_600);
    assert!(
        (deck.position() - 215_200.0).abs() < 2.0,
        "reverse: at {}",
        deck.position()
    );
    let first = base + offset(back[0]);
    let last = base + offset(back[back.len() - 2]);
    assert!(last < first - 8_000.0, "reverse audio {first} -> {last}");
    // Monotonic while moving backwards (allowing 16-bit resolution).
    let mut prev = f64::MAX;
    for v in back.iter().step_by(2).skip(200).take(2_000) {
        let v = base + offset(*v);
        assert!(v <= prev + 1.5, "reverse not monotonic: {v} after {prev}");
        prev = v;
    }

    deck.scratch_end();
    assert!(!deck.is_scratching());
    assert!((deck.position() - 215_200.0).abs() < 2.0);
}

#[test]
fn letting_go_resumes_playback_where_the_record_is() {
    // Cycle 100,000 … 150,000.
    let base = 100_000.0;
    let mut deck = deck_with(ramp_track(SR as usize * 10));
    deck.seek(120_000.0);
    deck.play();
    render(&mut deck, 1_000);
    deck.scratch_start();
    deck.scratch_move(-15_000.0);
    render(&mut deck, 8_000);
    deck.scratch_end();
    let here = deck.position();
    assert!((here - 106_000.0).abs() < 2.0, "after scratch {here}");
    let out = render(&mut deck, 480);
    let v = base + offset(out[2 * 479]);
    assert!(
        (v - (here + 479.0)).abs() < 2.0,
        "playing forward again from {here}: {v}"
    );
}

#[test]
fn bend_nudges_tempo_temporarily() {
    let mut deck = deck_with(sine_track(440.0, 4.0));
    deck.play();
    deck.set_bend(0.04);
    render(&mut deck, SR as usize);
    assert!((deck.position() - 1.04 * f64::from(SR)).abs() < 1.0);
    deck.set_bend(0.0);
    let before = deck.position();
    render(&mut deck, SR as usize);
    assert!((deck.position() - before - f64::from(SR)).abs() < 1.0);
}
