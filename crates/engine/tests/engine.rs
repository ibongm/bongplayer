//! The whole engine through the offline renderer: commands in, mixed audio out.

use std::path::PathBuf;
use std::sync::Arc;

use engine::eq::Band;
use engine::{decode_to_end, new_engine, offline, Command, DeckId, TrackBuffer};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn peak(buf: &[f32]) -> f32 {
    buf.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

#[test]
fn engine_plays_a_file_through_the_mixer_and_writes_a_wav() {
    let (mut handle, mut engine) = new_engine(48_000);
    let track = decode_to_end(&fixture("tone_44100.flac")).expect("decode");
    handle.load(DeckId::A, track).expect("load");
    handle.send(Command::SetCrossfader(0.0)).expect("xfader");
    handle.send(Command::Play(DeckId::A)).expect("play");

    let dir = std::env::temp_dir().join(format!("bong-engine-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let wav = dir.join("deck_a.wav");
    let out = offline::render_to_wav(&mut engine, 48_000, &wav).expect("render");

    // Tone at amplitude 0.5, crossfader fully on A, limiter ceiling −1 dBFS (0.891) not reached.
    let p = peak(&out[2 * 4_800..]);
    assert!((p - 0.5).abs() < 0.01, "peak {p}");
    let status = handle.status().deck(DeckId::A);
    assert!(status.is_playing());
    assert!(
        (status.position() - 44_100.0).abs() < 2.0,
        "position {}",
        status.position()
    );

    let bytes = std::fs::metadata(&wav).expect("wav written").len();
    assert_eq!(bytes, 44 + 48_000 * 2 * 4);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commands_reach_the_mixer() {
    let (mut handle, mut engine) = new_engine(48_000);
    let track = decode_to_end(&fixture("tone_44100.wav")).expect("decode");
    handle.load(DeckId::B, track).expect("load");
    for cmd in [
        Command::SetCrossfader(1.0),
        Command::SetKill {
            deck: DeckId::B,
            band: Band::Mid,
            kill: true,
        },
        Command::Play(DeckId::B),
    ] {
        handle.send(cmd).expect("send");
    }
    let out = offline::render(&mut engine, 24_000);
    // 1 kHz is in the mid band: killed.
    assert!(peak(&out[2 * 12_000..]) < 0.001, "mid kill not applied");

    handle
        .send(Command::SetKill {
            deck: DeckId::B,
            band: Band::Mid,
            kill: false,
        })
        .expect("send");
    let out = offline::render(&mut engine, 24_000);
    assert!(peak(&out[2 * 12_000..]) > 0.45, "mid not restored");
}

#[test]
fn hot_cue_via_commands_and_status() {
    let (mut handle, mut engine) = new_engine(48_000);
    let samples = vec![0.1f32; 2 * 480_000];
    handle
        .load(
            DeckId::A,
            Arc::new(TrackBuffer::from_interleaved(48_000, &samples)),
        )
        .expect("load");
    handle
        .send(Command::Seek {
            deck: DeckId::A,
            frame: 96_000.0,
        })
        .expect("seek");
    handle
        .send(Command::SetHotCue {
            deck: DeckId::A,
            slot: 7,
        })
        .expect("cue");
    offline::render(&mut engine, 256);
    assert_eq!(handle.status().deck(DeckId::A).hot_cue(7), Some(96_000.0));
    handle
        .send(Command::JumpHotCue {
            deck: DeckId::A,
            slot: 7,
        })
        .expect("jump");
    offline::render(&mut engine, 1);
    // Not playing: the head stays on the cue.
    assert_eq!(handle.status().deck(DeckId::A).position(), 96_000.0);
}

#[test]
fn unloaded_tracks_are_freed_on_the_control_side() {
    let (mut handle, mut engine) = new_engine(48_000);
    let track = Arc::new(TrackBuffer::from_interleaved(48_000, &[0.0; 2 * 100]));
    let weak = Arc::downgrade(&track);
    handle.load(DeckId::A, track).expect("load");
    offline::render(&mut engine, 64);
    handle.send(Command::Unload(DeckId::A)).expect("unload");
    offline::render(&mut engine, 64);
    assert!(
        weak.upgrade().is_some(),
        "still queued for the control thread"
    );
    handle.collect_garbage();
    assert!(weak.upgrade().is_none(), "freed by collect_garbage");
}

#[test]
fn queued_load_gets_a_kernel_for_the_new_rate() {
    let (mut handle, mut engine) = new_engine(44_100);
    let samples = vec![0.0f32; 2 * 1_000];
    handle
        .load(
            DeckId::A,
            Arc::new(TrackBuffer::from_interleaved(48_000, &samples)),
        )
        .expect("load");
    // The device turns out to run at 32 kHz before the engine ever rendered.
    engine.set_sample_rate(32_000);
    let cutoff = engine.deck_kernel_cutoff(DeckId::A).expect("loaded");
    assert!(
        (cutoff - 32_000.0 / 48_000.0).abs() < 1e-9,
        "cutoff {cutoff}"
    );
}

#[test]
fn sample_rate_change_keeps_position_and_settings() {
    let (mut handle, mut engine) = new_engine(48_000);
    let samples = vec![0.25f32; 2 * 441_000];
    handle
        .load(
            DeckId::A,
            Arc::new(TrackBuffer::from_interleaved(44_100, &samples)),
        )
        .expect("load");
    handle.send(Command::SetCrossfader(0.0)).expect("x");
    handle
        .send(Command::SetFader {
            deck: DeckId::A,
            position: 0.5,
        })
        .expect("fader");
    handle.send(Command::Play(DeckId::A)).expect("play");
    offline::render(&mut engine, 48_000);
    let before = handle.status().deck(DeckId::A).position();

    engine.set_sample_rate(44_100);
    assert_eq!(handle.status().sample_rate(), 44_100);
    let out = offline::render(&mut engine, 44_100);
    let after = handle.status().deck(DeckId::A).position();
    assert!(
        (after - before - 44_100.0).abs() < 1.0,
        "{before} -> {after}"
    );
    // 0.25 × fader 0.5
    let p = peak(&out[2 * 1_000..]);
    assert!((p - 0.125).abs() < 0.002, "level after rate change {p}");
}
