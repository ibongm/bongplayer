//! The status snapshot sent to the UI about 60 times a second (event "engine-status").

use std::sync::Arc;
use std::time::Duration;

use engine::deck::HOT_CUES;
use engine::DeckId;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{lock, AppState};

pub const STATUS_EVENT: &str = "engine-status";
const INTERVAL: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeckSnapshot {
    pub loaded: bool,
    pub track_id: Option<i64>,
    pub title: String,
    pub artist: String,
    pub path: Option<String>,
    /// Audible position in seconds.
    pub position: f64,
    /// Length in seconds (from the container while still decoding).
    pub duration: Option<f64>,
    pub playing: bool,
    pub ended: bool,
    pub tempo: f64,
    pub pitch: f64,
    pub pitch_range: f64,
    pub key_lock: bool,
    pub scratching: bool,
    /// Track BPM (as analysed / tagged) and the BPM at the current tempo.
    pub track_bpm: Option<f64>,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    /// 0.0 … 1.0 while decoding, 1.0 when done.
    pub decoded: f64,
    pub decode_error: Option<String>,
    /// Hot cue positions in seconds.
    pub cues: Vec<Option<f64>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputSnapshot {
    pub running: bool,
    pub device: Option<String>,
    pub reopens: u32,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub decks: [DeckSnapshot; 2],
    pub sample_rate: u32,
    pub output: OutputSnapshot,
}

pub fn snapshot(state: &AppState) -> StatusSnapshot {
    let decks = lock(&state.decks).clone();
    let deck = |id: DeckId| -> DeckSnapshot {
        let s = state.status.deck(id);
        let slot = decks[id as usize].as_ref();
        let rate = slot.map_or(44_100.0, |d| f64::from(d.buffer.sample_rate()));
        let frames_total = slot.and_then(|d| d.buffer.total_frames().or(d.expected_frames));
        let decoded = slot.map_or(0.0, |d| {
            if d.buffer.is_done() {
                1.0
            } else {
                d.expected_frames.filter(|&e| e > 0).map_or(0.0, |e| {
                    (d.buffer.frames_ready() as f64 / e as f64).min(0.99)
                })
            }
        });
        let decode_error = slot.and_then(|d| match d.buffer.state() {
            engine::DecodeState::Failed(msg) => Some(msg),
            _ => None,
        });
        let track_bpm = slot.and_then(|d| d.row.bpm);
        DeckSnapshot {
            loaded: slot.is_some() && s.is_loaded(),
            track_id: slot.map(|d| d.row.id),
            title: slot.map(|d| d.row.title.clone()).unwrap_or_default(),
            artist: slot.map(|d| d.row.artist.clone()).unwrap_or_default(),
            path: slot.and_then(|d| d.row.path.to_str().map(str::to_string)),
            position: s.position() / rate,
            duration: frames_total.map(|f| f as f64 / rate),
            playing: s.is_playing(),
            ended: s.has_ended(),
            tempo: s.tempo(),
            pitch: s.pitch(),
            pitch_range: s.pitch_range(),
            key_lock: s.key_lock(),
            scratching: s.is_scratching(),
            track_bpm,
            bpm: track_bpm.map(|b| b * s.tempo()),
            key: slot.and_then(|d| d.row.key.clone()),
            decoded,
            decode_error,
            cues: (0..HOT_CUES)
                .map(|i| s.hot_cue(i).map(|f| f / rate))
                .collect(),
        }
    };
    let output = match &state.output_state {
        Some(o) => OutputSnapshot {
            running: o.is_running(),
            device: o.current_device().map(|d| d.name),
            reopens: o.reopens(),
            problem: o.last_problem(),
        },
        None => OutputSnapshot {
            running: false,
            device: None,
            reopens: 0,
            problem: Some("audio output not started".into()),
        },
    };
    StatusSnapshot {
        decks: [deck(DeckId::A), deck(DeckId::B)],
        sample_rate: state.status.sample_rate(),
        output,
    }
}

/// Emits status snapshots until the app exits. Also frees tracks the engine let go of.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("bong-status".into())
        .spawn(move || loop {
            std::thread::sleep(INTERVAL);
            let Some(state) = app.try_state::<Arc<AppState>>() else {
                continue;
            };
            lock(&state.engine).collect_garbage();
            let snap = snapshot(&state);
            if app.emit(STATUS_EVENT, snap).is_err() {
                break;
            }
        });
    if let Err(e) = spawned {
        eprintln!("BongPlayer: status thread could not start: {e}");
    }
}
