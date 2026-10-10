//! M5 acceptance (app): Automix trigger threshold / crossfade time honoured; Loop, Shuffle,
//! Auto-remove behave as labelled; missing / corrupt tracks are skipped and the queue
//! continues; queue and position restored after a simulated crash; LOCK blocks and unlocks.
//!
//! Real generated audio files are played through the real engine, rendered offline; the
//! Automix controller is ticked every 50 ms of rendered audio, as the app's thread does.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use bongplayer_lib::automix::{AutomixConfig, Style};
use bongplayer_lib::commands::{run_engine_command, UiCommand};
use bongplayer_lib::state::{lock, AppState, DeckName};
use engine::{new_engine, offline, DeckId, Engine};
use library::Library;

const SR: u32 = 48_000;
const TICK: f64 = 0.05;

struct Rig {
    state: Arc<AppState>,
    engine: Engine,
    time: f64,
    dir: PathBuf,
    /// Track ids in the order they were queued.
    ids: Vec<i64>,
    /// Frequency of each track (to tell them apart).
    freqs: Vec<f64>,
}

fn write_tone(path: &Path, freq: f64, seconds: f64) {
    let n = (f64::from(SR) * seconds) as usize;
    let s: Vec<f32> = (0..n)
        .flat_map(|i| {
            let v =
                (0.3 * (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(SR)).sin()) as f32;
            [v, v]
        })
        .collect();
    offline::write_wav(path, SR, &s).expect("write wav");
}

impl Rig {
    fn new(dir: &Path, tracks: usize, seconds: f64, config: AutomixConfig) -> Self {
        let lib = Library::open(&dir.join("library.db")).expect("library");
        let (handle, engine) = new_engine(SR);
        let state = Arc::new(AppState::new(dir.join("library.db"), lib, handle, None));
        let mut paths = Vec::new();
        let mut freqs = Vec::new();
        for i in 0..tracks {
            let f = 300.0 + 100.0 * i as f64;
            let p = dir.join(format!("{:02} - Tone - Track {i}.wav", i + 1));
            write_tone(&p, f, seconds);
            paths.push(p);
            freqs.push(f);
        }
        let rows = state.rows_for_paths(&paths).expect("register");
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        lock(&state.queue).add(&ids, None);
        state.automix_set_config(config).expect("config");
        Rig {
            state,
            engine,
            time: 0.0,
            dir: dir.to_path_buf(),
            ids,
            freqs,
        }
    }

    /// Renders and ticks for `seconds`; calls `each` after every tick.
    fn run(&mut self, seconds: f64, mut each: impl FnMut(&Rig)) {
        let steps = (seconds / TICK).round() as usize;
        for i in 0..steps {
            offline::render(&mut self.engine, (f64::from(SR) * TICK) as usize);
            self.time += TICK;
            self.state.automix_tick(self.time, i as u64 * 7 + 3);
            each(self);
        }
    }

    fn playing_track(&self) -> Option<i64> {
        let am = lock(&self.state.automix);
        am.current.map(|c| c.track_id)
    }

    fn remaining(&self, deck: DeckName) -> f64 {
        let st = self.state.status.deck(deck.id());
        let rate = self.state.file_rate(deck).unwrap_or(SR);
        let decks = lock(&self.state.decks);
        let total = decks[deck.index()]
            .as_ref()
            .and_then(|d| d.total_frames())
            .unwrap_or(0) as f64;
        (total - st.position()) / f64::from(rate)
    }
}

fn config(trigger: f64, fade: f64) -> AutomixConfig {
    AutomixConfig {
        trigger_seconds: trigger,
        crossfade_seconds: fade,
        style: Style::Smooth,
        loop_queue: false,
        shuffle: false,
        auto_remove: false,
    }
}

#[test]
fn trigger_threshold_and_crossfade_time_are_honoured() {
    let dir = tempfile::tempdir().expect("tmp");
    let mut rig = Rig::new(dir.path(), 3, 12.0, config(4.0, 3.0));
    rig.state.automix_start().expect("start");
    let mut started: Option<(f64, f64)> = None; // (time, remaining on the old deck)
    let mut finished: Option<f64> = None;
    let mut was_active = false;
    rig.run(13.0, |r| {
        let active = r.state.status.transition_active();
        if active && !was_active && started.is_none() {
            started = Some((r.time, r.remaining(DeckName::A)));
        }
        if was_active && !active && finished.is_none() {
            finished = Some(r.time);
        }
        was_active = active;
    });
    let (t0, remaining) = started.expect("a transition started");
    let t1 = finished.expect("the transition finished");
    println!(
        "transition started with {remaining:.2} s left, lasted {:.2} s",
        t1 - t0
    );
    assert!(
        (remaining - 4.0).abs() <= 0.1,
        "started with {remaining:.2} s left (trigger 4 s)"
    );
    assert!(
        ((t1 - t0) - 3.0).abs() <= 0.11,
        "lasted {:.2} s (crossfade 3 s)",
        t1 - t0
    );
    assert_eq!(rig.playing_track(), Some(rig.ids[1]));
    assert!(rig.state.status.deck(DeckId::B).is_playing());
    assert!(!rig.state.status.deck(DeckId::A).is_playing());
    // The finished track was counted as played.
    let row = lock(&rig.state.library).track(rig.ids[0]).expect("row");
    assert_eq!(row.play_count, 1);
}

/// Plays until `count` tracks have started and returns their ids in order.
fn play_order(rig: &mut Rig, count: usize, max_seconds: f64) -> Vec<i64> {
    let mut order: Vec<i64> = Vec::new();
    rig.state.automix_start().expect("start");
    rig.run(max_seconds, |r| {
        if let Some(id) = r.playing_track() {
            if order.last() != Some(&id) && order.len() < count {
                order.push(id);
            }
        }
    });
    order
}

#[test]
fn plays_the_queue_in_order_and_stops_at_the_end_without_loop() {
    let dir = tempfile::tempdir().expect("tmp");
    let mut rig = Rig::new(dir.path(), 3, 4.0, config(1.0, 0.5));
    let order = play_order(&mut rig, 5, 14.0);
    assert_eq!(order, rig.ids, "each track once, in queue order");
    assert_eq!(rig.playing_track(), None, "nothing left to play");
}

#[test]
fn loop_starts_again_from_the_top() {
    let dir = tempfile::tempdir().expect("tmp");
    let mut cfg = config(1.0, 0.5);
    cfg.loop_queue = true;
    let mut rig = Rig::new(dir.path(), 2, 4.0, cfg);
    let order = play_order(&mut rig, 4, 14.0);
    assert_eq!(order, vec![rig.ids[0], rig.ids[1], rig.ids[0], rig.ids[1]]);
}

#[test]
fn shuffle_plays_every_track_once_in_a_different_order() {
    let dir = tempfile::tempdir().expect("tmp");
    let mut cfg = config(1.0, 0.5);
    cfg.shuffle = true;
    let mut rig = Rig::new(dir.path(), 6, 3.0, cfg);
    let order = play_order(&mut rig, 6, 20.0);
    assert_eq!(order.len(), 6);
    let mut sorted = order.clone();
    sorted.sort_unstable();
    let mut ids = rig.ids.clone();
    ids.sort_unstable();
    assert_eq!(sorted, ids, "every track exactly once");
    assert_ne!(order, rig.ids, "not the queue order");
}

#[test]
fn auto_remove_takes_played_tracks_out_of_the_queue() {
    let dir = tempfile::tempdir().expect("tmp");
    let mut cfg = config(1.0, 0.5);
    cfg.auto_remove = true;
    let mut rig = Rig::new(dir.path(), 3, 4.0, cfg);
    play_order(&mut rig, 2, 4.5);
    let queued: Vec<i64> = lock(&rig.state.queue)
        .items()
        .iter()
        .map(|i| i.track_id)
        .collect();
    assert_eq!(
        queued,
        vec![rig.ids[1], rig.ids[2]],
        "first track removed after it played"
    );
}

#[test]
fn missing_and_corrupt_tracks_are_skipped_and_the_queue_continues() {
    let dir = tempfile::tempdir().expect("tmp");
    let mut rig = Rig::new(dir.path(), 2, 4.0, config(1.0, 0.5));
    // Queue: good, missing, corrupt, good.
    let missing = rig.dir.join("gone.wav");
    write_tone(&missing, 900.0, 4.0);
    let corrupt = rig.dir.join("broken.mp3");
    std::fs::write(&corrupt, vec![7u8; 5000]).expect("write");
    let extra = rig
        .state
        .rows_for_paths(&[missing.clone(), corrupt])
        .expect("register");
    std::fs::remove_file(&missing).expect("delete");
    {
        let mut q = lock(&rig.state.queue);
        q.clear();
        q.add(&[rig.ids[0], extra[0].id, extra[1].id, rig.ids[1]], None);
    }
    let order = play_order(&mut rig, 3, 10.0);
    assert_eq!(
        order,
        vec![rig.ids[0], rig.ids[1]],
        "the two bad entries were skipped"
    );
    let msgs: Vec<String> = lock(&rig.state.automix).messages.iter().cloned().collect();
    assert!(
        msgs.iter().filter(|m| m.contains("skipped")).count() >= 2,
        "{msgs:?}"
    );
    let _ = &rig.freqs;
}

#[test]
fn queue_and_position_are_restored_after_a_crash() {
    let dir = tempfile::tempdir().expect("tmp");
    let db = dir.path().join("library.db");
    let (queue_before, playing, position) = {
        let mut rig = Rig::new(dir.path(), 3, 12.0, config(4.0, 1.0));
        rig.state.automix_start().expect("start");
        rig.run(11.0, |_| {}); // into the second track
        let cur = lock(&rig.state.automix).current.expect("playing");
        let rate = rig.state.file_rate(cur.deck).expect("rate");
        let pos = rig.state.status.deck(cur.deck.id()).position() / f64::from(rate);
        rig.state.automix_save().expect("save");
        let q: Vec<(u64, i64)> = lock(&rig.state.queue)
            .items()
            .iter()
            .map(|i| (i.uid, i.track_id))
            .collect();
        (q, cur.track_id, pos)
        // The app "crashes" here: everything is dropped without a clean shutdown.
    };
    let lib = Library::open(&db).expect("reopen");
    let (handle, mut engine) = new_engine(SR);
    let state = AppState::new(db, lib, handle, None);
    assert!(
        state.automix_restore().expect("restore"),
        "playback resumed"
    );
    offline::render(&mut engine, SR as usize / 10);
    let q: Vec<(u64, i64)> = lock(&state.queue)
        .items()
        .iter()
        .map(|i| (i.uid, i.track_id))
        .collect();
    assert_eq!(q, queue_before, "same queue, same entries");
    let cur = lock(&state.automix).current.expect("current restored");
    assert_eq!(cur.track_id, playing);
    let rate = state.file_rate(cur.deck).expect("rate");
    let pos = state.status.deck(cur.deck.id()).position() / f64::from(rate);
    println!("saved at {position:.2} s, resumed at {pos:.2} s");
    assert!(
        (pos - position).abs() < 0.3,
        "resumed at {pos:.2} s, saved {position:.2} s"
    );
    assert!(state.status.deck(cur.deck.id()).is_playing());
    assert!(lock(&state.automix).on);
}

#[test]
fn lock_blocks_music_controls_and_unlocks_with_pin_or_hold() {
    let dir = tempfile::tempdir().expect("tmp");
    let rig = Rig::new(dir.path(), 1, 2.0, config(4.0, 1.0));
    let s = &rig.state;
    s.lock_configure(true, false, None, Some(Some("2468")))
        .expect("set PIN");
    s.lock_engage().expect("lock");

    let play = UiCommand::Play { deck: DeckName::A };
    assert!(run_engine_command(s, play.clone()).is_err_and(|e| e.contains("Locked")));
    let xf = UiCommand::Crossfader { position: 0.2 };
    assert!(run_engine_command(s, xf).is_err());
    assert!(
        s.load_track(DeckName::A, rig.ids[0]).is_ok(),
        "loading itself is checked by the command layer"
    );
    assert!(s.automix_start().is_ok());
    // Volume still works (option on).
    assert!(run_engine_command(s, UiCommand::Master { db: -3.0 }).is_ok());
    assert!(run_engine_command(
        s,
        UiCommand::Fader {
            deck: DeckName::A,
            position: 0.5
        }
    )
    .is_ok());

    // Holding LOCK is switched off; a wrong PIN fails; the right PIN unlocks.
    assert!(s.lock_release(None, true).is_err());
    assert!(s
        .lock_release(Some("1111"), false)
        .is_err_and(|e| e.contains("Wrong PIN")));
    s.lock_release(Some("2468"), false).expect("unlock");
    assert!(run_engine_command(s, play.clone()).is_ok());

    // With hold allowed and volume not allowed.
    s.lock_configure(false, true, Some("2468"), None)
        .expect("options");
    s.lock_engage().expect("lock");
    assert!(run_engine_command(s, UiCommand::Master { db: -6.0 }).is_err());
    s.lock_release(None, true).expect("hold unlocks");
    assert!(run_engine_command(s, play).is_ok());

    // Changing the PIN needs the current one.
    assert!(s
        .lock_configure(true, true, Some("0000"), Some(Some("1357")))
        .is_err());
    assert!(
        s.lock_configure(true, true, Some("2468"), Some(Some("12")))
            .is_err(),
        "too short"
    );
    s.lock_configure(true, true, Some("2468"), Some(None))
        .expect("remove PIN");
}
