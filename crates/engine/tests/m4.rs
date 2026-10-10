//! M4 (engine side): meters match the rendered audio; auto-loops, loop IN/OUT, resize and
//! exit; CUE / CUP; KEY shift; channel filter.

use std::sync::Arc;

use engine::deck::{Deck, LoadedTrack};
use engine::{new_engine, offline, Command, DeckId, TrackBuffer};

const SR: u32 = 48_000;

fn sine(freq: f64, seconds: f64, amp: f64) -> Arc<TrackBuffer> {
    let n = (f64::from(SR) * seconds) as usize;
    let s: Vec<f32> = (0..n)
        .flat_map(|i| {
            let v =
                (amp * (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(SR)).sin()) as f32;
            [v, v]
        })
        .collect();
    Arc::new(TrackBuffer::from_interleaved(SR, &s))
}

/// Left channel = (index mod 32768) / 32768, right = index / 32768: exact at the same rate.
fn index_track(frames: usize) -> Arc<TrackBuffer> {
    let s: Vec<f32> = (0..frames)
        .flat_map(|i| {
            [
                (i % 32_768) as f32 / 32_768.0,
                (i / 32_768) as f32 / 32_768.0,
            ]
        })
        .collect();
    Arc::new(TrackBuffer::from_interleaved(SR, &s))
}

fn index_of(l: f32, r: f32) -> i64 {
    (r * 32_768.0).round() as i64 * 32_768 + (l * 32_768.0).round() as i64
}

fn deck_with(track: Arc<TrackBuffer>) -> Deck {
    let mut d = Deck::new(SR);
    d.load(LoadedTrack::new(track, SR));
    d
}

fn render(deck: &mut Deck, frames: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; 2 * frames];
    for b in out.chunks_mut(2 * 256) {
        deck.render(b);
    }
    out
}

fn indices(out: &[f32]) -> Vec<i64> {
    out.as_chunks::<2>()
        .0
        .iter()
        .map(|f| index_of(f[0], f[1]))
        .collect()
}

fn rms(s: &[f32]) -> f64 {
    (s.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
}

#[test]
fn meters_match_the_rms_of_the_rendered_audio() {
    let (mut h, mut engine) = new_engine(SR);
    h.load(DeckId::A, sine(1000.0, 4.0, 0.5)).expect("load");
    h.send(Command::SetCrossfader(0.0)).expect("x");
    h.send(Command::Play(DeckId::A)).expect("play");
    // The meter covers one process() call: compare with exactly that block.
    offline::render(&mut engine, 4_800);
    let mut block = vec![0.0f32; 2 * 960];
    engine.process(&mut block);
    let master = h.status().meter(2).expect("master");
    let measured = rms(&block);
    assert!(
        (f64::from(master.rms()) - measured).abs() < 1e-5,
        "meter {} vs rendered {measured}",
        master.rms()
    );
    let peak = block.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!((master.peak() - peak).abs() < 1e-6);
    // Deck A carries the tone (≈ 0.354 RMS); deck B is silent.
    let a = h.status().meter(0).expect("A");
    assert!(
        (f64::from(a.rms()) - 0.5 / 2f64.sqrt()).abs() < 0.01,
        "deck A {}",
        a.rms()
    );
    assert_eq!(h.status().meter(1).expect("B").rms(), 0.0);
}

#[test]
fn auto_loop_repeats_sample_accurately_and_exits() {
    let mut d = deck_with(index_track(SR as usize * 4));
    d.seek(5_000.0);
    d.play();
    d.auto_loop(1_000.0);
    let out = indices(&render(&mut d, 2_500));
    let expected: Vec<i64> = (0..2_500).map(|i| 5_000 + (i % 1_000) as i64).collect();
    assert_eq!(out, expected);
    assert_eq!(d.loop_state(), (Some(5_000.0), Some(6_000.0), true));
    d.loop_exit();
    let out = indices(&render(&mut d, 1_000));
    assert_eq!(out[0], 5_500);
    assert_eq!(
        out[999], 6_499,
        "after exit the track continues past the loop end"
    );
}

#[test]
fn loop_in_out_resize() {
    let mut d = deck_with(index_track(SR as usize * 4));
    d.seek(10_000.0);
    d.play();
    d.loop_set_in();
    render(&mut d, 400);
    d.loop_set_out();
    assert_eq!(d.loop_state(), (Some(10_000.0), Some(10_400.0), true));
    let out = indices(&render(&mut d, 800));
    assert_eq!(out[0], 10_000);
    assert_eq!(out[399], 10_399);
    assert_eq!(out[400], 10_000);
    d.loop_resize(0.5);
    assert_eq!(d.loop_state().1, Some(10_200.0));
    d.loop_resize(4.0);
    assert_eq!(d.loop_state().1, Some(10_800.0));
    // OUT before IN does not make a loop.
    let mut d = deck_with(index_track(SR as usize));
    d.seek(500.0);
    d.loop_set_in();
    d.seek(100.0);
    d.loop_set_out();
    assert!(!d.loop_state().2);
}

#[test]
fn loops_work_with_key_lock() {
    let mut d = deck_with(index_track(SR as usize * 4));
    d.set_key_lock(true);
    d.seek(20_000.0);
    d.play();
    render(&mut d, 1_000);
    d.auto_loop(4_800.0);
    render(&mut d, 48_000);
    let p = d.position();
    assert!(
        (20_000.0..=26_000.0).contains(&p),
        "with key lock the head stays in the loop region: {p}"
    );
}

#[test]
fn cue_and_cup() {
    let mut d = deck_with(index_track(SR as usize * 4));
    d.seek(2_000.0);
    // Paused: CUE sets the cue point here and previews while held.
    d.cue_press();
    assert!(d.is_playing());
    assert_eq!(d.main_cue(), 2_000.0);
    render(&mut d, 300);
    d.cue_release();
    assert!(!d.is_playing());
    assert_eq!(d.position(), 2_000.0);
    // Playing: CUE returns to the cue point and stops.
    d.play();
    render(&mut d, 1_000);
    d.cue_press();
    d.cue_release();
    assert!(!d.is_playing());
    assert_eq!(d.position(), 2_000.0);
    // CUP: jump to the cue point and play.
    d.seek(9_000.0);
    d.cue_play();
    assert!(d.is_playing());
    let out = indices(&render(&mut d, 10));
    assert_eq!(out[0], 2_000);
}

fn frequency(signal: &[f32]) -> f64 {
    let left: Vec<f32> = signal.iter().step_by(2).copied().collect();
    let mut crossings = Vec::new();
    for i in 1..left.len() {
        if left[i - 1] < 0.0 && left[i] >= 0.0 {
            let frac = f64::from(-left[i - 1] / (left[i] - left[i - 1]));
            crossings.push((i - 1) as f64 + frac);
        }
    }
    let (first, last) = (crossings[0], crossings[crossings.len() - 1]);
    (crossings.len() - 1) as f64 * f64::from(SR) / (last - first)
}

fn cents(a: f64, b: f64) -> f64 {
    1200.0 * (a / b).log2()
}

#[test]
fn key_shift_transposes_with_and_without_key_lock() {
    // Shift alone: +12 semitones doubles the frequency, tempo unchanged.
    let mut d = deck_with(sine(440.0, 6.0, 0.5));
    d.set_key_shift(12.0);
    d.play();
    let out = render(&mut d, 2 * SR as usize);
    let f = frequency(&out[SR as usize..]);
    assert!(cents(f, 880.0).abs() <= 5.0, "+12: {f} Hz");
    assert!((d.position() - 2.0 * f64::from(SR)).abs() < 0.01 * f64::from(SR));

    // Key lock at +8 % tempo with −2 semitones: the key drops two semitones from 440 Hz.
    let mut d = deck_with(sine(440.0, 6.0, 0.5));
    d.set_pitch(0.08);
    d.set_key_lock(true);
    d.set_key_shift(-2.0);
    d.play();
    let out = render(&mut d, 2 * SR as usize);
    let want = 440.0 * 2f64.powf(-2.0 / 12.0);
    let f = frequency(&out[SR as usize..]);
    assert!(
        cents(f, want).abs() <= 5.0,
        "key lock −2: {f} Hz, want {want}"
    );
    assert!(d.key_shift() == -2.0);
    d.set_key_shift(40.0);
    assert_eq!(d.key_shift(), 12.0, "clamped to ±12");
}

fn engine_level(filter: f32, freq: f64) -> f64 {
    let (mut h, mut engine) = new_engine(SR);
    h.load(DeckId::A, sine(freq, 2.0, 0.3)).expect("load");
    h.send(Command::SetCrossfader(0.0)).expect("x");
    h.send(Command::SetFilter {
        deck: DeckId::A,
        value: filter,
    })
    .expect("filter");
    h.send(Command::Play(DeckId::A)).expect("play");
    let out = offline::render(&mut engine, SR as usize);
    20.0 * (rms(&out[SR as usize..]) / (0.3 / 2f64.sqrt())).log10()
}

#[test]
fn filter_low_pass_high_pass_and_off() {
    // Centre: untouched.
    assert!(engine_level(0.0, 5_000.0).abs() < 0.1);
    // Fully left (low-pass at 80 Hz): 5 kHz is gone, 30 Hz passes.
    assert!(engine_level(-1.0, 5_000.0) < -60.0);
    assert!(engine_level(-1.0, 30.0).abs() < 3.5);
    // Fully right (high-pass at 8 kHz): 100 Hz is gone, 15 kHz passes.
    assert!(engine_level(1.0, 100.0) < -60.0);
    assert!(engine_level(1.0, 15_000.0).abs() < 3.5);
    // Half way left: a 1 kHz cutoff region — 5 kHz clearly cut, 200 Hz mostly kept.
    assert!(engine_level(-0.5, 5_000.0) < -20.0);
    assert!(engine_level(-0.5, 200.0) > -3.5);
}

// ----- live sources (M6) -----

use engine::live::LiveBuffer;

#[test]
fn live_deck_plays_behind_the_newest_audio_waits_on_underrun_and_never_ends() {
    let live = Arc::new(LiveBuffer::new(SR));
    let mut d = Deck::new(SR);
    d.load(LoadedTrack::live(Arc::clone(&live), SR));
    d.play();
    // Nothing yet: silence, still "playing" (waiting for the stream).
    let out = render(&mut d, 4_800);
    assert!(out.iter().all(|v| *v == 0.0));

    // 3 s of an index-encoded stream arrive.
    let feed = |from: usize, n: usize| -> Vec<f32> {
        (from..from + n)
            .flat_map(|i| {
                [
                    (i % 32_768) as f32 / 32_768.0,
                    (i / 32_768) as f32 / 32_768.0,
                ]
            })
            .collect()
    };
    live.push(&feed(0, 3 * SR as usize));
    let out = indices(&render(&mut d, 4_800));
    // Plays 2 s behind the newest frame (prebuffer), continuously.
    assert_eq!(out[0], SR as i64);
    assert_eq!(out[4_799], SR as i64 + 4_799);

    // The stream stalls: when the deck catches up it outputs silence instead of garbage.
    let out = render(&mut d, 2 * SR as usize);
    let tail = &out[out.len() - 200..];
    assert!(tail.iter().all(|v| *v == 0.0), "underrun is silent");
    assert!(d.is_playing() && !d.has_ended(), "a live deck never ends");

    // Seeking, loops and scratching do nothing on a live stream.
    let before = d.position();
    d.seek(10.0);
    d.auto_loop(1_000.0);
    d.scratch_start();
    assert_eq!(d.position(), before);
    assert!(!d.loop_state().2 && !d.is_scratching());
}
