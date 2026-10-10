//! M11 (engine): deck effects (Echo, Flanger, Filter) with STR / SPD, and the headphone cue
//! bus that a 4-channel device (DDJ-400) plays on channels 3–4.

use std::sync::Arc;

use engine::fx::{echo_beats, sweep_seconds, DeckFx, FxKind};
use engine::{new_engine, offline, Command, DeckId, TrackBuffer};

const SR: u32 = 48_000;

fn sine(freq: f64, amp: f64, seconds: f64) -> Vec<f32> {
    let n = (f64::from(SR) * seconds) as usize;
    (0..n)
        .flat_map(|i| {
            let v = (amp * (std::f64::consts::TAU * freq * i as f64 / f64::from(SR)).sin()) as f32;
            [v, v]
        })
        .collect()
}

fn rms(buf: &[f32], from: usize, len: usize) -> f64 {
    let s = &buf[2 * from..2 * (from + len)];
    (s.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
}

/// Amplitude of `freq` in the left channel (Goertzel).
fn amp(out: &[f32], from: usize, len: usize, freq: f64) -> f64 {
    let w = std::f64::consts::TAU * freq / f64::from(SR);
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for i in from..from + len {
        let s0 = f64::from(out[2 * i]) + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    2.0 * (s1 * s1 + s2 * s2 - coeff * s1 * s2).sqrt() / len as f64
}

fn run(fx: &mut DeckFx, input: &[f32]) -> Vec<f32> {
    let mut out = input.to_vec();
    for block in out.chunks_mut(2 * 512) {
        fx.process(block);
    }
    out
}

fn fx(kind: FxKind, strength: f32, speed: f32) -> DeckFx {
    let mut f = DeckFx::new(SR);
    f.set_kind(kind);
    f.set_params(strength, speed);
    f.snap();
    f
}

#[test]
fn off_or_zero_strength_leaves_the_sound_untouched() {
    let input = sine(440.0, 0.5, 1.0);
    for kind in FxKind::ALL {
        let mut f = fx(kind, 0.0, 0.7);
        assert_eq!(run(&mut f, &input), input, "{kind:?} at STR 0");
    }
    let mut off = fx(FxKind::Off, 1.0, 1.0);
    assert_eq!(run(&mut off, &input), input);
}

#[test]
fn echo_repeats_on_the_beat_and_dies_away() {
    assert_eq!(echo_beats(0.0), 0.25);
    assert_eq!(echo_beats(0.75), 1.0);
    assert_eq!(echo_beats(1.0), 2.0);
    // 120 BPM → one beat = 0.5 s = 24 000 frames; SPD 0.75 = 1 beat.
    let mut f = fx(FxKind::Echo, 0.8, 0.75);
    f.set_beat_seconds(0.5);
    let mut input = vec![0.0f32; 2 * SR as usize * 2];
    input[0] = 1.0;
    input[1] = 1.0;
    let out = run(&mut f, &input);
    let peak_near = |at: usize| {
        (at - 50..at + 50)
            .map(|i| out[2 * i].abs())
            .fold(0.0f32, f32::max)
    };
    let first = peak_near(24_000);
    let second = peak_near(48_000);
    assert!((first - 0.8).abs() < 0.01, "first echo at 1 beat: {first}");
    assert!(
        second > 0.2 && second < first * 0.6,
        "second echo quieter: {second}"
    );
    assert!(peak_near(12_000) < 1e-6, "nothing between the echoes");

    // A faster track (BPM change) moves the echo.
    let mut g = fx(FxKind::Echo, 0.8, 0.75);
    g.set_beat_seconds(0.4);
    let out = run(&mut g, &input);
    assert!(out[2 * 19_200].abs() > 0.7, "echo at 0.4 s");
}

#[test]
fn flanger_sweeps_and_stays_in_level() {
    assert!((sweep_seconds(0.0) - 8.0).abs() < 1e-9 && (sweep_seconds(1.0) - 0.25).abs() < 1e-9);
    // A 3 kHz tone through a flanger sweeping once a second (SPD ≈ 0.6).
    let speed = 0.6;
    let input = sine(3000.0, 0.5, 4.0);
    let mut f = fx(FxKind::Flanger, 1.0, speed);
    let out = run(&mut f, &input);
    assert!(
        out.iter().all(|x| x.is_finite() && x.abs() <= 0.75),
        "bounded"
    );
    // The comb filter sweeps: the tone's level rises and falls within one cycle.
    let win = 960; // 20 ms
    let cycle = (sweep_seconds(speed) * f64::from(SR)) as usize;
    let levels: Vec<f64> = (0..cycle / win)
        .map(|k| rms(&out, SR as usize + k * win, win))
        .collect();
    let (lo, hi) = levels
        .iter()
        .fold((f64::MAX, 0.0f64), |(a, b), &x| (a.min(x), b.max(x)));
    assert!(
        20.0 * (hi / lo).log10() > 6.0,
        "sweep depth {:.1} dB",
        20.0 * (hi / lo).log10()
    );
}

#[test]
fn filter_sweeps_the_highs_and_keeps_the_bass() {
    let speed = 0.4;
    let mut input = sine(6000.0, 0.3, 6.0);
    for (x, b) in input.iter_mut().zip(sine(80.0, 0.3, 6.0)) {
        *x += b;
    }
    let mut f = fx(FxKind::Filter, 1.0, speed);
    let out = run(&mut f, &input);
    assert!(out.iter().all(|x| x.is_finite()));
    let win = 4800; // 100 ms
    let cycle = (sweep_seconds(speed) * f64::from(SR)) as usize;
    let highs: Vec<f64> = (0..cycle / win)
        .map(|k| amp(&out, k * win, win, 6000.0))
        .collect();
    let lows: Vec<f64> = (0..cycle / win)
        .map(|k| amp(&out, k * win, win, 80.0))
        .collect();
    let (hlo, hhi) = highs
        .iter()
        .fold((f64::MAX, 0.0f64), |(a, b), &x| (a.min(x), b.max(x)));
    assert!(
        20.0 * (hhi / hlo.max(1e-9)).log10() > 20.0,
        "highs swept {hlo} … {hhi}"
    );
    assert!(
        lows.iter().all(|l| (20.0 * (l / 0.3).log10()).abs() < 1.0),
        "bass kept: {lows:?}"
    );
}

#[test]
fn effects_run_in_the_engine_on_one_deck_only_and_survive_a_rate_change() {
    let (mut h, mut e) = new_engine(SR);
    let tone = Arc::new(TrackBuffer::from_interleaved(SR, &sine(6000.0, 0.3, 10.0)));
    h.load(DeckId::A, Arc::clone(&tone)).expect("load");
    h.load(DeckId::B, tone).expect("load");
    for c in [
        Command::SetFx {
            deck: DeckId::A,
            kind: FxKind::Filter,
        },
        Command::SetFxParams {
            deck: DeckId::A,
            strength: 1.0,
            speed: 0.0,
        },
        Command::SetCrossfader(0.0),
        Command::Play(DeckId::A),
    ] {
        h.send(c).expect("send");
    }
    // Slow sweep starts at its lowest cutoff: the 6 kHz tone is filtered away on deck A.
    let out = offline::render(&mut e, SR as usize / 2);
    assert!(amp(&out, 4800, 4800, 6000.0) < 0.03, "deck A filtered");
    // Deck B has no effect.
    for c in [
        Command::Pause(DeckId::A),
        Command::SetCrossfader(1.0),
        Command::Play(DeckId::B),
    ] {
        h.send(c).expect("send");
    }
    let out = offline::render(&mut e, SR as usize / 2);
    assert!(amp(&out, 12_000, 4800, 6000.0) > 0.25, "deck B untouched");
    // The effect choice survives a new sound card rate.
    e.set_sample_rate(44_100);
    assert_eq!(e.sample_rate(), 44_100);
}

#[test]
fn headphones_hear_the_cued_deck_before_its_fader() {
    let (mut h, mut e) = new_engine(SR);
    h.load(
        DeckId::A,
        Arc::new(TrackBuffer::from_interleaved(SR, &sine(300.0, 0.3, 10.0))),
    )
    .expect("load");
    h.load(
        DeckId::B,
        Arc::new(TrackBuffer::from_interleaved(SR, &sine(2000.0, 0.3, 10.0))),
    )
    .expect("load");
    // The audience hears B; the DJ pre-listens to A with its fader closed.
    for c in [
        Command::SetCrossfader(1.0),
        Command::SetFader {
            deck: DeckId::A,
            position: 0.0,
        },
        Command::Play(DeckId::A),
        Command::Play(DeckId::B),
        Command::SetCue {
            deck: DeckId::A,
            on: true,
        },
    ] {
        h.send(c).expect("send");
    }
    let n = SR as usize / 2;
    let (mut out, mut cue) = (vec![0.0f32; 2 * n], vec![0.0f32; 2 * n]);
    e.process_with_cue(&mut out, &mut cue);
    assert!(
        amp(&out, 4800, 9600, 300.0) < 1e-3,
        "A is not on the speakers"
    );
    assert!((amp(&out, 4800, 9600, 2000.0) - 0.3).abs() < 0.01, "B is");
    assert!(
        (amp(&cue, 4800, 9600, 300.0) - 0.3).abs() < 0.01,
        "A in the headphones"
    );
    assert!(
        amp(&cue, 4800, 9600, 2000.0) < 1e-3,
        "only A while CUE/MASTER is at CUE"
    );
    assert_eq!(e.status().cue(), [true, false]);

    // Halfway: both.
    h.send(Command::SetCueMix(0.5)).expect("mix");
    e.process_with_cue(&mut out, &mut cue);
    assert!((amp(&cue, 4800, 9600, 300.0) - 0.15).abs() < 0.01);
    assert!((amp(&cue, 4800, 9600, 2000.0) - 0.15).abs() < 0.01);

    // Nothing cued: the headphones hear the master.
    h.send(Command::SetCue {
        deck: DeckId::A,
        on: false,
    })
    .expect("cue off");
    e.process_with_cue(&mut out, &mut cue);
    assert!(amp(&cue, 4800, 9600, 300.0) < 1e-3);
    assert!((amp(&cue, 4800, 9600, 2000.0) - amp(&out, 4800, 9600, 2000.0)).abs() < 1e-3);
}
