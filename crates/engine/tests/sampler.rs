//! M9 acceptance (engine): the sampler never routes through the deck faders; the music ducks
//! −9 dB over 50 ms while a pad plays and comes back over 250 ms; choke groups; pad gain.

use std::sync::Arc;

use engine::sampler::{Sample, SampleError};
use engine::{new_engine, offline, Command, DeckId, Engine, EngineHandle, TrackBuffer};

const SR: u32 = 48_000;

fn sine(rate: u32, freq: f64, amp: f64, seconds: f64) -> Vec<f32> {
    let n = (f64::from(rate) * seconds) as usize;
    (0..n)
        .flat_map(|i| {
            let v = (amp * (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(rate)).sin())
                as f32;
            [v, v]
        })
        .collect()
}

/// Amplitude of `freq` in the left channel (Goertzel).
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
    2.0 * (s1 * s1 + s2 * s2 - coeff * s1 * s2).sqrt() / len as f64
}

fn db(ratio: f64) -> f64 {
    20.0 * ratio.log10()
}

fn send(h: &mut EngineHandle, cmds: impl IntoIterator<Item = Command>) {
    for c in cmds {
        h.send(c).expect("send");
    }
}

/// Deck A plays a 200 Hz tone (amplitude 0.25) on the crossfader's A side.
fn with_music() -> (EngineHandle, Engine) {
    let (mut h, mut e) = new_engine(SR);
    let music = Arc::new(TrackBuffer::from_interleaved(
        SR,
        &sine(SR, 200.0, 0.25, 10.0),
    ));
    h.load(DeckId::A, music).expect("load");
    send(
        &mut h,
        [Command::SetCrossfader(0.0), Command::Play(DeckId::A)],
    );
    offline::render(&mut e, SR as usize / 4);
    (h, e)
}

#[test]
fn sampler_never_goes_through_the_deck_faders() {
    let (mut h, mut e) = with_music();
    h.load_pad(0, Sample::from_interleaved(SR, &sine(SR, 1000.0, 0.5, 1.0)))
        .expect("pad");
    // Every deck control turned down or off: faders closed, crossfader away from A,
    // EQ killed, filter fully on.
    send(
        &mut h,
        [
            Command::SetFader {
                deck: DeckId::A,
                position: 0.0,
            },
            Command::SetFader {
                deck: DeckId::B,
                position: 0.0,
            },
            Command::SetCrossfader(1.0),
            Command::SetFilter {
                deck: DeckId::A,
                value: -1.0,
            },
        ],
    );
    for band in engine::eq::Band::ALL {
        h.send(Command::SetKill {
            deck: DeckId::A,
            band,
            kill: true,
        })
        .expect("kill");
    }
    offline::render(&mut e, SR as usize / 10);
    h.send(Command::TriggerPad(0)).expect("trigger");
    let out = offline::render(&mut e, SR as usize / 2);
    let pad = amp(&out, 4800, 9600, 1000.0);
    assert!((pad - 0.5).abs() < 0.005, "pad at full level, got {pad}");
    assert!(amp(&out, 4800, 9600, 200.0) < 1e-3, "the music stays off");
    assert_eq!(e.status().pads_playing(), 1);
}

#[test]
fn music_ducks_minus_9_db_over_50_ms_and_returns_over_250_ms() {
    let (mut h, mut e) = with_music();
    // A 3 kHz sound of exactly 0.5 s.
    h.load_pad(3, Sample::from_interleaved(SR, &sine(SR, 3000.0, 0.1, 0.5)))
        .expect("pad");
    let before = offline::render(&mut e, SR as usize / 5);
    let level = amp(&before, 0, 9600, 200.0);
    assert!((level - 0.25).abs() < 0.003, "music level before: {level}");

    h.send(Command::TriggerPad(3)).expect("trigger");
    // Render 1 ms at a time and read the ducking the engine reports.
    let ms = SR as usize / 1000;
    let mut duck = Vec::new();
    let mut out = Vec::new();
    for _ in 0..1000 {
        out.extend(offline::render(&mut e, ms));
        duck.push(f64::from(e.status().sampler_duck_db()));
    }
    // duck[k] = level after k + 1 ms. Down: a straight ramp in dB reaching −9 at 50 ms.
    assert!(
        (duck[24] + 4.5).abs() < 0.2,
        "half way at 25 ms: {}",
        duck[24]
    );
    assert!(
        duck[47] > -9.0 + 0.1,
        "not there before 50 ms: {}",
        duck[47]
    );
    assert!(
        (duck[49] + 9.0).abs() < 0.01,
        "−9 dB at 50 ms: {}",
        duck[49]
    );
    assert!(
        duck[50..499].iter().all(|d| (d + 9.0).abs() < 0.01),
        "held while the pad plays"
    );
    // The pad ends at 500 ms; the music comes back over 250 ms.
    assert_eq!(e.status().pads_playing(), 0);
    let end = duck
        .iter()
        .rposition(|d| (d + 9.0).abs() < 0.01)
        .expect("ducked")
        + 1;
    assert!(
        (499..=501).contains(&end),
        "release starts when the pad ends (at {end} ms)"
    );
    assert!(
        (duck[end + 124] + 4.5).abs() < 0.2,
        "half way back at +125 ms: {}",
        duck[end + 124]
    );
    assert!(
        duck[end + 246] < -0.03,
        "not back before 250 ms: {}",
        duck[end + 246]
    );
    assert!(
        duck[end + 249].abs() < 0.01,
        "back at 0 dB at +250 ms: {}",
        duck[end + 249]
    );

    // And in the sound itself: the music is 9 dB lower while the pad plays…
    let ducked = amp(&out, 100 * ms, 300 * ms, 200.0);
    assert!(
        (db(ducked / level) + 9.0).abs() < 0.2,
        "music ducked by {:.2} dB",
        db(ducked / level)
    );
    // …the pad itself is not ducked…
    let pad = amp(&out, 100 * ms, 300 * ms, 3000.0);
    assert!((pad - 0.1).abs() < 0.002, "pad level {pad}");
    // …and the music is back to full afterwards.
    let after = amp(&out, (end + 300) * ms, 150 * ms, 200.0);
    assert!(
        (db(after / level)).abs() < 0.1,
        "music after: {:.2} dB",
        db(after / level)
    );
}

#[test]
fn choke_group_cuts_the_other_pad_and_pad_gain_applies() {
    let (mut h, mut e) = new_engine(SR);
    for pad in 0..3 {
        h.load_pad(
            pad,
            Sample::from_interleaved(SR, &sine(SR, 500.0 + 500.0 * pad as f64, 0.2, 2.0)),
        )
        .expect("pad");
    }
    send(
        &mut h,
        [
            Command::SetPadChoke { pad: 0, group: 1 },
            Command::SetPadChoke { pad: 1, group: 1 },
            Command::SetPadGainDb { pad: 2, db: -6.0 },
            Command::TriggerPad(0),
            Command::TriggerPad(2),
        ],
    );
    offline::render(&mut e, SR as usize / 10);
    assert_eq!(e.status().pads_playing(), 0b101);
    h.send(Command::TriggerPad(1)).expect("trigger");
    let out = offline::render(&mut e, SR as usize / 2);
    assert_eq!(
        e.status().pads_playing(),
        0b110,
        "pad 1 cut pad 0 (same group); pad 2 plays on"
    );
    assert!(amp(&out, 4800, 9600, 500.0) < 1e-3, "pad 0 is silent");
    assert!((amp(&out, 4800, 9600, 1000.0) - 0.2).abs() < 0.003);
    let quiet = amp(&out, 4800, 9600, 1500.0);
    assert!(
        (db(quiet / 0.2) + 6.0).abs() < 0.1,
        "pad gain −6 dB, got {:.2}",
        db(quiet / 0.2)
    );
    // The choke fades (5 ms) instead of clicking: no jump bigger than the signals allow.
    let jumps = out
        .as_chunks::<2>()
        .0
        .iter()
        .map(|f| f[0])
        .collect::<Vec<_>>();
    let worst = jumps
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .fold(0.0f32, f32::max);
    assert!(worst < 0.1, "largest step {worst}");

    h.send(Command::StopAllPads).expect("stop");
    offline::render(&mut e, SR as usize / 100);
    assert_eq!(e.status().pads_playing(), 0);
}

#[test]
fn samples_at_another_rate_play_at_the_right_pitch_and_length() {
    let (mut h, mut e) = new_engine(SR);
    h.load_pad(
        7,
        Sample::from_interleaved(44_100, &sine(44_100, 1000.0, 0.3, 0.5)),
    )
    .expect("pad");
    h.send(Command::TriggerPad(7)).expect("trigger");
    let out = offline::render(&mut e, SR as usize);
    assert!(
        (amp(&out, 2400, 9600, 1000.0) - 0.3).abs() < 0.005,
        "1 kHz stays 1 kHz"
    );
    let last = out
        .as_chunks::<2>()
        .0
        .iter()
        .rposition(|f| f[0].abs() > 1e-4)
        .expect("sound");
    // 0.5 s = 24 000 frames, plus the limiter's 1.5 ms look-ahead (72 frames) that delays
    // everything on the master output.
    assert!(
        (last as i64 - (24_000 + 72)).abs() < 8,
        "0.5 s long, ended at frame {last}"
    );
}

#[test]
fn long_files_are_refused_and_replaced_samples_are_freed_off_the_audio_thread() {
    let long = TrackBuffer::from_interleaved(SR, &vec![0.0; 2 * 31 * SR as usize]);
    assert!(matches!(
        Sample::from_track(&long),
        Err(SampleError::TooLong { .. })
    ));
    let empty = TrackBuffer::from_interleaved(SR, &[]);
    assert!(matches!(
        Sample::from_track(&empty),
        Err(SampleError::Empty)
    ));
    let ok = TrackBuffer::from_interleaved(SR, &sine(SR, 440.0, 0.1, 1.0));
    assert_eq!(Sample::from_track(&ok).expect("ok").frames(), SR as usize);

    let (mut h, mut e) = new_engine(SR);
    let first = Arc::new(Sample::from_interleaved(SR, &sine(SR, 440.0, 0.1, 1.0)));
    h.send(Command::LoadPad {
        pad: 0,
        sample: Some(Arc::clone(&first)),
    })
    .expect("load");
    offline::render(&mut e, 480);
    assert_eq!(Arc::strong_count(&first), 2, "the engine holds it");
    h.send(Command::LoadPad {
        pad: 0,
        sample: None,
    })
    .expect("clear");
    offline::render(&mut e, 480);
    h.collect_garbage();
    assert_eq!(
        Arc::strong_count(&first),
        1,
        "handed back to the control thread and dropped there"
    );
}
