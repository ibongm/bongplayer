//! M5 acceptance (engine): Automix transitions (Smooth, Bass Swap, Cut, Echo-Out) render
//! correctly offline; no gap in Smooth. DUCK lowers and restores the music.

use std::sync::Arc;

use engine::{
    new_engine, offline, Command, DeckId, Engine, EngineHandle, TrackBuffer, TransitionStyle,
};

const SR: u32 = 48_000;

fn tones(freqs: &[(f64, f64)], seconds: f64) -> Arc<TrackBuffer> {
    let n = (f64::from(SR) * seconds) as usize;
    let s: Vec<f32> = (0..n)
        .flat_map(|i| {
            let t = i as f64 / f64::from(SR);
            let v: f64 = freqs
                .iter()
                .map(|(f, a)| a * (2.0 * std::f64::consts::PI * f * t).sin())
                .sum();
            [v as f32, v as f32]
        })
        .collect();
    Arc::new(TrackBuffer::from_interleaved(SR, &s))
}

/// Both decks playing, crossfader on A.
fn setup(a: Arc<TrackBuffer>, b: Arc<TrackBuffer>) -> (EngineHandle, Engine) {
    let (mut h, mut e) = new_engine(SR);
    h.load(DeckId::A, a).expect("load A");
    h.load(DeckId::B, b).expect("load B");
    for c in [
        Command::SetCrossfader(0.0),
        Command::Play(DeckId::A),
        Command::Play(DeckId::B),
    ] {
        h.send(c).expect("send");
    }
    offline::render(&mut e, SR as usize / 2); // settle
    (h, e)
}

fn start(h: &mut EngineHandle, style: TransitionStyle, seconds: f64) {
    h.send(Command::StartTransition {
        from: DeckId::A,
        to: DeckId::B,
        style,
        seconds,
        echo_seconds: 0.25,
    })
    .expect("transition");
}

/// Amplitude of `freq` in the left channel of `frames` (Goertzel).
fn amp(out: &[f32], from: usize, len: usize, freq: f64) -> f64 {
    let w = 2.0 * std::f64::consts::PI * freq / f64::from(SR);
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for i in from..from + len {
        let x = f64::from(out[2 * i]);
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    2.0 * power.sqrt() / len as f64
}

fn rms(out: &[f32], from: usize, len: usize) -> f64 {
    (out[2 * from..2 * (from + len)]
        .iter()
        .map(|v| f64::from(*v).powi(2))
        .sum::<f64>()
        / (2 * len) as f64)
        .sqrt()
}

const MS: usize = (SR / 1000) as usize;

#[test]
fn smooth_crossfade_has_no_gap_and_ends_on_the_new_track() {
    let (mut h, mut e) = setup(tones(&[(440.0, 0.4)], 20.0), tones(&[(660.0, 0.4)], 20.0));
    let done = h.status().transitions_done();
    start(&mut h, TransitionStyle::Smooth, 4.0);
    let out = offline::render(&mut e, 6 * SR as usize);
    let steady = 0.4 / 2f64.sqrt();
    // No gap: every 10 ms window keeps at least half the level of one track.
    let mut lowest = f64::MAX;
    for w in (0..out.len() / 2 - 10 * MS).step_by(10 * MS) {
        lowest = lowest.min(rms(&out, w, 10 * MS));
    }
    println!(
        "smooth: lowest 10 ms level {:.3} (one track {:.3})",
        lowest, steady
    );
    assert!(lowest > 0.5 * steady, "level dipped to {lowest:.3}");
    // Half way both tracks sound at about −3 dB (equal power).
    let mid = 2 * SR as usize - 25 * MS;
    let (a, b) = (
        amp(&out, mid, 50 * MS, 440.0),
        amp(&out, mid, 50 * MS, 660.0),
    );
    assert!(
        (a / 0.4 - 0.707).abs() < 0.06 && (b / 0.4 - 0.707).abs() < 0.06,
        "mid: A {a:.3} B {b:.3}"
    );
    // After the transition only the new track plays and deck A has stopped.
    let end = 5 * SR as usize;
    assert!(amp(&out, end, 100 * MS, 440.0) < 0.004);
    assert!((amp(&out, end, 100 * MS, 660.0) - 0.4).abs() < 0.02);
    assert!(!h.status().deck(DeckId::A).is_playing());
    assert!(h.status().deck(DeckId::B).is_playing());
    assert_eq!(h.status().transitions_done(), done + 1);
    assert!((h.status().crossfader() - 1.0).abs() < 1e-6);
}

#[test]
fn cut_switches_within_20_ms() {
    let (mut h, mut e) = setup(tones(&[(440.0, 0.4)], 10.0), tones(&[(660.0, 0.4)], 10.0));
    start(&mut h, TransitionStyle::Cut, 4.0);
    let out = offline::render(&mut e, SR as usize / 2);
    assert!(
        amp(&out, 20 * MS, 50 * MS, 440.0) < 0.01,
        "old track gone after 20 ms"
    );
    assert!((amp(&out, 20 * MS, 50 * MS, 660.0) - 0.4).abs() < 0.03);
    assert!(!h.status().transition_active());
}

#[test]
fn bass_swap_swaps_the_bass_half_way() {
    // A: bass 60 Hz + lead 1 kHz; B: bass 80 Hz + lead 2.5 kHz.
    let (mut h, mut e) = setup(
        tones(&[(60.0, 0.3), (1_000.0, 0.2)], 20.0),
        tones(&[(80.0, 0.3), (2_500.0, 0.2)], 20.0),
    );
    start(&mut h, TransitionStyle::BassSwap, 4.0);
    let out = offline::render(&mut e, 5 * SR as usize);
    let at = |s: f64| (s * f64::from(SR)) as usize;
    let w = 200 * MS;
    // First half: the new track's lead comes in, its bass is held back; the old bass plays.
    let (b_bass_early, b_lead_early) =
        (amp(&out, at(1.2), w, 80.0), amp(&out, at(1.2), w, 2_500.0));
    let a_bass_early = amp(&out, at(1.2), w, 60.0);
    assert!(b_bass_early < 0.01, "incoming bass early: {b_bass_early}");
    assert!(b_lead_early > 0.05, "incoming lead early: {b_lead_early}");
    assert!(a_bass_early > 0.1);
    // Second half: the old bass is gone, the new bass plays.
    let (a_bass_late, b_bass_late) = (amp(&out, at(2.8), w, 60.0), amp(&out, at(2.8), w, 80.0));
    assert!(a_bass_late < 0.01, "outgoing bass late: {a_bass_late}");
    assert!(b_bass_late > 0.1, "incoming bass late: {b_bass_late}");
    // After the end the kills are lifted again: B's bass at full level.
    assert!((amp(&out, at(4.5), w, 80.0) - 0.3).abs() < 0.03);
}

#[test]
fn echo_out_rings_out_and_the_new_track_starts_at_once() {
    let (mut h, mut e) = setup(
        tones(&[(1_000.0, 0.4)], 20.0),
        tones(&[(3_000.0, 0.4)], 20.0),
    );
    start(&mut h, TransitionStyle::EchoOut, 4.0);
    let out = offline::render(&mut e, 5 * SR as usize);
    let at = |s: f64| (s * f64::from(SR)) as usize;
    let w = 100 * MS;
    // The new track is there right away (crossfader centred: −3 dB).
    let b = amp(&out, at(0.05), 50 * MS, 3_000.0);
    assert!((b / 0.4 - 0.707).abs() < 0.08, "incoming at {b}");
    // The old track's direct sound is gone after 0.3 s, but its echo keeps ringing and fades.
    let e1 = amp(&out, at(0.6), w, 1_000.0);
    let e2 = amp(&out, at(2.0), w, 1_000.0);
    assert!(e1 > 0.02, "echo audible at 0.6 s: {e1}");
    assert!(e2 < e1 * 0.5, "echo fades: {e1} → {e2}");
    // After the transition: old deck stopped, echo cleared, new track at full level.
    assert!(amp(&out, at(4.6), w, 1_000.0) < 0.002);
    assert!((amp(&out, at(4.6), w, 3_000.0) - 0.4).abs() < 0.03);
    assert!(!h.status().deck(DeckId::A).is_playing());
}

#[test]
fn duck_lowers_and_restores_the_music() {
    let (mut h, mut e) = setup(tones(&[(500.0, 0.4)], 20.0), tones(&[(500.0, 0.0)], 20.0));
    h.send(Command::ConfigureDuck {
        depth_db: 12.0,
        attack_seconds: 0.3,
        release_seconds: 0.6,
    })
    .expect("cfg");
    h.send(Command::SetDuck {
        on: true,
        depth_db: 12.0,
    })
    .expect("duck");
    let out = offline::render(&mut e, SR as usize);
    let level = |o: &[f32], s: f64| {
        20.0 * (amp(o, (s * f64::from(SR)) as usize, 50 * MS, 500.0) / 0.4).log10()
    };
    assert!(
        (level(&out, 0.4) + 12.0).abs() < 0.5,
        "ducked: {:.2} dB",
        level(&out, 0.4)
    );
    assert!((h.status().duck_db() + 12.0).abs() < 0.01);
    h.send(Command::SetDuck {
        on: false,
        depth_db: 12.0,
    })
    .expect("release");
    let out = offline::render(&mut e, SR as usize);
    assert!(
        level(&out, 0.7).abs() < 0.3,
        "restored: {:.2} dB",
        level(&out, 0.7)
    );
}
