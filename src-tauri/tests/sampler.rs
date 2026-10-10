//! M9 acceptance (app): a sound file put on a pad plays through the real engine (rendered
//! offline); pad volume / choke group are saved and the pads come back after a restart; a
//! missing file shows on its pad; LOCK blocks changing pads but not playing them.

use std::path::{Path, PathBuf};

use bongplayer_lib::state::AppState;
use engine::{new_engine, offline, Engine};
use library::Library;

const SR: u32 = 48_000;

fn tone(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../crates/engine/tests/fixtures")
        .join(name)
}

fn app(db: &Path) -> (AppState, Engine) {
    let (handle, engine) = new_engine(SR);
    let state = AppState::new(
        db.to_path_buf(),
        Library::open(db).expect("db"),
        handle,
        None,
    );
    (state, engine)
}

#[test]
fn pads_load_play_save_and_come_back_after_a_restart() {
    let dir = tempfile::tempdir().expect("tmp");
    let db = dir.path().join("lib.db");
    let sound = dir.path().join("Air Horn.wav");
    std::fs::copy(tone("tone_44100.wav"), &sound).expect("copy");

    {
        let (state, mut engine) = app(&db);
        assert!(state.sampler_trigger(0).is_err(), "an empty pad says so");
        let pads = state.sampler_load(0, &sound).expect("load");
        assert_eq!(pads[0].name, "Air Horn");
        assert!(
            pads[0].seconds.is_some_and(|s| (s - 2.0).abs() < 0.01),
            "{:?}",
            pads[0].seconds
        );
        state.sampler_configure(0, -6.0, 2).expect("configure");
        state
            .sampler_load(5, &tone("tone_48000.flac"))
            .expect("load flac");

        state.sampler_trigger(0).expect("play");
        let out = offline::render(&mut engine, SR as usize / 2);
        assert_eq!(engine.status().pads_playing(), 1);
        let peak = out.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.1, "the pad is heard (peak {peak})");
        state.sampler_stop(None).expect("stop");
        offline::render(&mut engine, SR as usize / 100);
        assert_eq!(engine.status().pads_playing(), 0);
    }

    // "Restart": a new app on the same database, with one file gone.
    std::fs::remove_file(&sound).expect("rm");
    let (state, mut engine) = app(&db);
    state.sampler_restore();
    let pads = state.sampler_pads();
    assert_eq!((pads[0].gain_db, pads[0].choke), (-6.0, 2), "settings kept");
    assert!(
        pads[0]
            .error
            .as_deref()
            .is_some_and(|e| e.contains("not found")),
        "{:?}",
        pads[0].error
    );
    assert!(pads[0].seconds.is_none());
    assert!(
        pads[5].error.is_none() && pads[5].seconds.is_some(),
        "the other pad still loads"
    );
    assert!(pads[1].path.is_none());
    state.sampler_trigger(5).expect("restored pad plays");
    offline::render(&mut engine, SR as usize / 10);
    assert_eq!(engine.status().pads_playing(), 1 << 5);
}

#[test]
fn bad_files_are_refused_with_a_message_and_lock_blocks_changes_not_playing() {
    let dir = tempfile::tempdir().expect("tmp");
    let (state, _engine) = app(&dir.path().join("lib.db"));
    let corrupt = tone("corrupt.mp3");
    let e = state.sampler_load(1, &corrupt).expect_err("corrupt");
    assert!(!e.is_empty());
    assert!(
        state.sampler_load(8, &tone("tone_48000.wav")).is_err(),
        "only pads 1–8"
    );
    assert!(
        state.sampler_configure(0, 0.0, 9).is_err(),
        "choke groups are 1–4"
    );

    state
        .sampler_load(2, &tone("tone_48000.wav"))
        .expect("load");
    state.lock_engage().expect("lock");
    assert!(state.sampler_load(3, &tone("tone_48000.wav")).is_err());
    assert!(state.sampler_clear(2).is_err());
    assert!(state.sampler_configure(2, -3.0, 0).is_err());
    state
        .sampler_trigger(2)
        .expect("pads still play while locked");
    state.sampler_stop(Some(2)).expect("and stop");
}
