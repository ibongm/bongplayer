//! M6 (app): radio works as a deck source and as an Automix item.
//! A tiny local server streams an MP3 tone with an ICY title.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use bongplayer_lib::automix::{AutomixConfig, Style};
use bongplayer_lib::state::{lock, AppState, DeckName};
use bongplayer_lib::status::snapshot;
use engine::{new_engine, offline, DeckId};
use library::Library;

const SR: u32 = 48_000;

fn serve_mp3() -> String {
    let mp3 = std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../crates/radio/tests/fixtures/tone_44100.mp3"),
    )
    .expect("fixture");
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut s) = conn else { continue };
            let mp3 = mp3.clone();
            std::thread::spawn(move || {
                let mut r = BufReader::new(s.try_clone().expect("clone"));
                loop {
                    let mut l = String::new();
                    if r.read_line(&mut l).is_err() || l.trim().is_empty() {
                        break;
                    }
                }
                let metaint = 8192usize;
                let _ = s.write_all(
                    format!("HTTP/1.0 200 OK\r\nContent-Type: audio/mpeg\r\nicy-metaint: {metaint}\r\nicy-name: Local FM\r\n\r\n")
                        .as_bytes(),
                );
                let title = b"StreamTitle='Local Artist - Local Song';";
                let mut block = vec![(title.len().div_ceil(16)) as u8];
                block.extend(title);
                block.resize(1 + title.len().div_ceil(16) * 16, 0);
                let mut pos = 0usize;
                loop {
                    let mut chunk = Vec::with_capacity(metaint + block.len());
                    while chunk.len() < metaint {
                        let take = (mp3.len() - pos).min(metaint - chunk.len());
                        chunk.extend_from_slice(&mp3[pos..pos + take]);
                        pos = (pos + take) % mp3.len();
                    }
                    chunk.extend(&block);
                    if s.write_all(&chunk).is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(4));
                }
            });
        }
    });
    format!("http://127.0.0.1:{port}/stream")
}

fn tone(path: &Path, seconds: f64) {
    let n = (f64::from(SR) * seconds) as usize;
    let s: Vec<f32> = (0..n)
        .flat_map(|i| {
            let v = (0.3 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / f64::from(SR)).sin())
                as f32;
            [v, v]
        })
        .collect();
    offline::write_wav(path, SR, &s).expect("wav");
}

#[test]
fn a_station_plays_on_a_deck_with_its_title() {
    let dir = tempfile::tempdir().expect("tmp");
    let lib = Library::open(&dir.path().join("lib.db")).expect("lib");
    let (handle, mut engine) = new_engine(SR);
    let state = AppState::new(dir.path().join("lib.db"), lib, handle, None);
    let url = serve_mp3();
    state
        .load_station(DeckName::A, None, "Local FM", &url, 60)
        .expect("load");
    state.send(engine::Command::SetCrossfader(0.0)).expect("x");
    state.send(engine::Command::Play(DeckId::A)).expect("play");
    let mut heard = 0.0f32;
    for _ in 0..200 {
        let out = offline::render(&mut engine, 2_400);
        heard = heard.max(out.iter().fold(0.0f32, |m, v| m.max(v.abs())));
        if heard > 0.3 {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        heard > 0.3,
        "the station's tone reaches the output: peak {heard}"
    );
    let snap = snapshot(&state);
    let d = &snap.decks[0];
    assert!(d.live);
    assert_eq!(d.title, "Local Artist - Local Song");
    assert_eq!(d.artist, "Local FM");
    assert_eq!(d.radio_state.as_deref(), Some("playing"));
    assert_eq!(d.duration, None, "a station has no length");
}

#[test]
fn a_station_is_an_automix_item_between_two_tracks() {
    let dir = tempfile::tempdir().expect("tmp");
    let db = dir.path().join("lib.db");
    let lib = Library::open(&db).expect("lib");
    let (handle, mut engine) = new_engine(SR);
    let state = Arc::new(AppState::new(db, lib, handle, None));
    let (a, b) = (dir.path().join("a.wav"), dir.path().join("b.wav"));
    tone(&a, 4.0);
    tone(&b, 4.0);
    let rows = state.rows_for_paths(&[a, b]).expect("rows");
    let url = serve_mp3();
    let sid = lock(&state.library)
        .save_station(None, "Local FM", &url, 1)
        .expect("station");
    {
        let mut q = lock(&state.queue);
        q.add(&[rows[0].id], None);
        q.add_station(sid, None);
        q.add(&[rows[1].id], None);
    }
    state
        .automix_set_config(AutomixConfig {
            trigger_seconds: 1.0,
            crossfade_seconds: 0.5,
            style: Style::Smooth,
            loop_queue: false,
            shuffle: false,
            auto_remove: false,
        })
        .expect("config");
    state.automix_start().expect("start");
    let mut order: Vec<String> = Vec::new();
    let mut t = 0.0;
    for i in 0..3_000 {
        offline::render(&mut engine, 2_400);
        t += 0.05;
        state.automix_tick(t, i);
        let cur = lock(&state.automix).current;
        if let Some(c) = cur {
            let name = match c.station_id {
                Some(_) => "station".to_string(),
                None => format!("track {}", c.track_id),
            };
            if order.last() != Some(&name) {
                order.push(name);
            }
        }
        if order.len() == 3 {
            break;
        }
        // Give the network a moment: the offline engine runs much faster than real time.
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(
        order,
        vec![
            format!("track {}", rows[0].id),
            "station".to_string(),
            format!("track {}", rows[1].id),
        ],
        "track → station (for its play time) → next track"
    );
    // The station played about its 1-minute play time before Automix moved on.
    assert!(t > 60.0, "moved on after {t:.1} s of simulated time");
}
