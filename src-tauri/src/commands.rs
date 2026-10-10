//! Tauri commands: thin wrappers that run the work off the UI thread and turn errors into
//! messages the UI can show.

use std::path::PathBuf;
use std::sync::Arc;

use engine::eq::Band;
use engine::Command;
use library::browse::{self, DirListing, Drive, FolderEntry};
use library::{
    AnalysisReport, CrateInfo, CrateKind, ImportReport, ScanStats, StationRow, TrackRow,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::automix::AutomixConfig;
use crate::lock::Action;
use crate::state::{err, lock, AppResult, AppState, DeckName, QueueEntry};
use crate::status::{snapshot, StatusSnapshot};
use crate::waveform::WaveState;

type St<'a> = State<'a, Arc<AppState>>;

/// Runs blocking work (files, database, analysis) on a worker thread.
async fn blocking<T, F>(state: &St<'_>, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> AppResult<T> + Send + 'static,
{
    let s = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || f(&s))
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

// ----- app & system -----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

pub fn app_info_value() -> AppInfo {
    AppInfo {
        name: "BongPlayer".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    app_info_value()
}

#[tauri::command]
pub async fn list_drives() -> AppResult<Vec<Drive>> {
    tauri::async_runtime::spawn_blocking(browse::drives)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn special_folders() -> AppResult<Vec<FolderEntry>> {
    tauri::async_runtime::spawn_blocking(browse::special_folders)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn list_dir(path: PathBuf) -> AppResult<DirListing> {
    tauri::async_runtime::spawn_blocking(move || {
        browse::list_dir(&path).map_err(|e| format!("cannot open {}: {e}", path.display()))
    })
    .await
    .map_err(err)?
}

/// Opens Windows Explorer with the file selected.
#[tauri::command]
pub async fn show_in_explorer(path: PathBuf) -> AppResult<()> {
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    let mut arg = std::ffi::OsString::from("/select,");
    arg.push(path.as_os_str());
    std::process::Command::new("explorer")
        .arg(arg)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open Explorer: {e}"))
}

#[tauri::command]
pub fn engine_status(state: St<'_>) -> StatusSnapshot {
    snapshot(&state)
}

// ----- library -----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderTracks {
    pub rows: Vec<TrackRow>,
    pub stats: ScanStats,
}

#[tauri::command]
pub async fn folder_tracks(state: St<'_>, path: PathBuf) -> AppResult<FolderTracks> {
    blocking(&state, move |s| {
        let listing =
            browse::list_dir(&path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
        let (rows, stats) = lock(&s.library)
            .tracks_for_paths(&listing.audio_files)
            .map_err(err)?;
        Ok(FolderTracks { rows, stats })
    })
    .await
}

#[tauri::command]
pub async fn library_tracks(state: St<'_>) -> AppResult<Vec<TrackRow>> {
    blocking(&state, |s| lock(&s.library).all_tracks().map_err(err)).await
}

/// Registers files and folders (e.g. from an Explorer drop or "Import") with the library.
#[tauri::command]
pub async fn import_paths(state: St<'_>, paths: Vec<PathBuf>) -> AppResult<Vec<TrackRow>> {
    blocking(&state, move |s| {
        let files = AppState::expand_paths(&paths);
        s.rows_for_paths(&files)
    })
    .await
}

#[tauri::command]
pub async fn crates_list(state: St<'_>) -> AppResult<Vec<CrateInfo>> {
    blocking(&state, |s| lock(&s.library).crates().map_err(err)).await
}

#[tauri::command]
pub async fn crate_create(state: St<'_>, name: String, kind: CrateKind) -> AppResult<i64> {
    blocking(&state, move |s| {
        lock(&s.library).create_crate(&name, kind).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn crate_rename(state: St<'_>, id: i64, name: String) -> AppResult<()> {
    blocking(&state, move |s| {
        lock(&s.library).rename_crate(id, &name).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn crate_delete(state: St<'_>, id: i64) -> AppResult<()> {
    blocking(&state, move |s| {
        lock(&s.library).delete_crate(id).map_err(err)
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrateEntry {
    pub position: i64,
    pub track: TrackRow,
}

#[tauri::command]
pub async fn crate_tracks(state: St<'_>, id: i64) -> AppResult<Vec<CrateEntry>> {
    blocking(&state, move |s| {
        Ok(lock(&s.library)
            .crate_tracks(id)
            .map_err(err)?
            .into_iter()
            .map(|(position, track)| CrateEntry { position, track })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn crate_add(state: St<'_>, id: i64, track_ids: Vec<i64>) -> AppResult<usize> {
    blocking(&state, move |s| {
        lock(&s.library).add_to_crate(id, &track_ids).map_err(err)
    })
    .await
}

/// Adds files/folders (Explorer drop onto a crate).
#[tauri::command]
pub async fn crate_add_paths(state: St<'_>, id: i64, paths: Vec<PathBuf>) -> AppResult<usize> {
    blocking(&state, move |s| {
        let files = AppState::expand_paths(&paths);
        let ids: Vec<i64> = s.rows_for_paths(&files)?.iter().map(|r| r.id).collect();
        lock(&s.library).add_to_crate(id, &ids).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn crate_remove(state: St<'_>, id: i64, positions: Vec<i64>) -> AppResult<usize> {
    blocking(&state, move |s| {
        lock(&s.library)
            .remove_from_crate(id, &positions)
            .map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn import_m3u(state: St<'_>, path: PathBuf) -> AppResult<ImportReport> {
    blocking(&state, move |s| {
        lock(&s.library).import_m3u(&path).map_err(err)
    })
    .await
}

/// Analyses BPM and key on a separate database connection so the library stays usable.
#[tauri::command]
pub async fn analyze_tracks(state: St<'_>, track_ids: Vec<i64>) -> AppResult<AnalysisReport> {
    blocking(&state, move |s| {
        let lib = library::Library::open(&s.db_path).map_err(err)?;
        lib.analyze_tracks(&track_ids).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn mark_played(state: St<'_>, track_ids: Vec<i64>) -> AppResult<usize> {
    blocking(&state, move |s| {
        lock(&s.library).mark_played(&track_ids).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn remove_tracks(state: St<'_>, track_ids: Vec<i64>) -> AppResult<usize> {
    blocking(&state, move |s| {
        let n = lock(&s.library).remove_tracks(&track_ids).map_err(err)?;
        let mut q = lock(&s.queue);
        let gone: Vec<u64> = q
            .items()
            .iter()
            .filter(|i| track_ids.contains(&i.track_id))
            .map(|i| i.uid)
            .collect();
        q.remove(&gone);
        Ok(n)
    })
    .await
}

#[tauri::command]
pub async fn set_rating(state: St<'_>, track_ids: Vec<i64>, rating: u8) -> AppResult<usize> {
    blocking(&state, move |s| {
        lock(&s.library).set_rating(&track_ids, rating).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn set_bpm(state: St<'_>, track_ids: Vec<i64>, bpm: Option<f64>) -> AppResult<usize> {
    blocking(&state, move |s| {
        lock(&s.library)
            .set_bpm_override(&track_ids, bpm)
            .map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn setting_get(state: St<'_>, key: String) -> AppResult<Option<String>> {
    blocking(&state, move |s| lock(&s.library).setting(&key).map_err(err)).await
}

#[tauri::command]
pub async fn setting_set(state: St<'_>, key: String, value: String) -> AppResult<()> {
    blocking(&state, move |s| {
        lock(&s.library).set_setting(&key, &value).map_err(err)
    })
    .await
}

// ----- decks -----

#[tauri::command]
pub async fn deck_load(state: St<'_>, deck: DeckName, track_id: i64) -> AppResult<TrackRow> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| s.load_track(deck, track_id)).await
}

#[tauri::command]
pub async fn deck_load_path(state: St<'_>, deck: DeckName, path: PathBuf) -> AppResult<TrackRow> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| s.load_path(deck, &path)).await
}

#[tauri::command]
pub fn hot_cue_set(state: St<'_>, deck: DeckName, slot: usize) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    state.set_hot_cue(deck, slot)
}

#[tauri::command]
pub fn hot_cue_clear(state: St<'_>, deck: DeckName, slot: usize) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    state.clear_hot_cue(deck, slot)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BandName {
    Low,
    Mid,
    High,
}

impl From<BandName> for Band {
    fn from(b: BandName) -> Self {
        match b {
            BandName::Low => Band::Low,
            BandName::Mid => Band::Mid,
            BandName::High => Band::High,
        }
    }
}

/// Everything the UI can tell the engine directly.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiCommand {
    Play {
        deck: DeckName,
    },
    Pause {
        deck: DeckName,
    },
    TogglePlay {
        deck: DeckName,
    },
    Seek {
        deck: DeckName,
        seconds: f64,
    },
    JumpHotCue {
        deck: DeckName,
        slot: usize,
    },
    Pitch {
        deck: DeckName,
        pitch: f64,
    },
    PitchRange {
        deck: DeckName,
        range: f64,
    },
    Bend {
        deck: DeckName,
        bend: f64,
    },
    KeyLock {
        deck: DeckName,
        on: bool,
    },
    ScratchStart {
        deck: DeckName,
    },
    ScratchMove {
        deck: DeckName,
        seconds: f64,
    },
    ScratchEnd {
        deck: DeckName,
    },
    Trim {
        deck: DeckName,
        db: f32,
    },
    Eq {
        deck: DeckName,
        band: BandName,
        db: f32,
    },
    Kill {
        deck: DeckName,
        band: BandName,
        on: bool,
    },
    Fader {
        deck: DeckName,
        position: f32,
    },
    Filter {
        deck: DeckName,
        value: f32,
    },
    CuePress {
        deck: DeckName,
    },
    CueRelease {
        deck: DeckName,
    },
    CuePlay {
        deck: DeckName,
    },
    KeyShift {
        deck: DeckName,
        semitones: f64,
    },
    LoopIn {
        deck: DeckName,
    },
    LoopOut {
        deck: DeckName,
    },
    /// Loop of this many beats (needs the track's BPM).
    AutoLoop {
        deck: DeckName,
        beats: f64,
    },
    LoopResize {
        deck: DeckName,
        factor: f64,
    },
    LoopExit {
        deck: DeckName,
    },
    LoopReenter {
        deck: DeckName,
    },
    /// Match this deck's tempo to the other deck.
    Sync {
        deck: DeckName,
    },
    Crossfader {
        position: f32,
    },
    Master {
        db: f32,
    },
    LimiterCeiling {
        db: f32,
    },
}

/// Translates a UI command into an engine command (positions in seconds → track frames).
pub fn to_engine(state: &AppState, cmd: UiCommand) -> AppResult<Command> {
    let frames = |deck: DeckName, seconds: f64| -> AppResult<f64> {
        let rate = state.file_rate(deck).ok_or("no track loaded")?;
        Ok(seconds * f64::from(rate))
    };
    Ok(match cmd {
        UiCommand::Play { deck } => Command::Play(deck.id()),
        UiCommand::Pause { deck } => Command::Pause(deck.id()),
        UiCommand::TogglePlay { deck } => {
            if state.status.deck(deck.id()).is_playing() {
                Command::Pause(deck.id())
            } else {
                Command::Play(deck.id())
            }
        }
        UiCommand::Seek { deck, seconds } => Command::Seek {
            deck: deck.id(),
            frame: frames(deck, seconds.max(0.0))?,
        },
        UiCommand::JumpHotCue { deck, slot } => Command::JumpHotCue {
            deck: deck.id(),
            slot,
        },
        UiCommand::Pitch { deck, pitch } => Command::SetPitch {
            deck: deck.id(),
            pitch,
        },
        UiCommand::PitchRange { deck, range } => Command::SetPitchRange {
            deck: deck.id(),
            range,
        },
        UiCommand::Bend { deck, bend } => Command::SetBend {
            deck: deck.id(),
            bend,
        },
        UiCommand::KeyLock { deck, on } => Command::SetKeyLock {
            deck: deck.id(),
            on,
        },
        UiCommand::ScratchStart { deck } => Command::ScratchStart(deck.id()),
        UiCommand::ScratchMove { deck, seconds } => Command::ScratchMove {
            deck: deck.id(),
            frames: frames(deck, seconds)?,
        },
        UiCommand::ScratchEnd { deck } => Command::ScratchEnd(deck.id()),
        UiCommand::Trim { deck, db } => Command::SetTrimDb {
            deck: deck.id(),
            db,
        },
        UiCommand::Eq { deck, band, db } => Command::SetEqDb {
            deck: deck.id(),
            band: band.into(),
            db,
        },
        UiCommand::Kill { deck, band, on } => Command::SetKill {
            deck: deck.id(),
            band: band.into(),
            kill: on,
        },
        UiCommand::Fader { deck, position } => Command::SetFader {
            deck: deck.id(),
            position,
        },
        UiCommand::Filter { deck, value } => Command::SetFilter {
            deck: deck.id(),
            value,
        },
        UiCommand::CuePress { deck } => Command::CuePress(deck.id()),
        UiCommand::CueRelease { deck } => Command::CueRelease(deck.id()),
        UiCommand::CuePlay { deck } => Command::CuePlay(deck.id()),
        UiCommand::KeyShift { deck, semitones } => Command::SetKeyShift {
            deck: deck.id(),
            semitones,
        },
        UiCommand::LoopIn { deck } => Command::LoopIn(deck.id()),
        UiCommand::LoopOut { deck } => Command::LoopOut(deck.id()),
        UiCommand::AutoLoop { deck, beats } => {
            let bpm = state
                .track_bpm(deck)
                .ok_or("auto-loop needs the track's BPM (analyze it or use TAP)")?;
            Command::AutoLoop {
                deck: deck.id(),
                frames: frames(deck, beats.max(1.0 / 32.0) * 60.0 / bpm)?,
            }
        }
        UiCommand::LoopResize { deck, factor } => Command::LoopResize {
            deck: deck.id(),
            factor,
        },
        UiCommand::LoopExit { deck } => Command::LoopExit(deck.id()),
        UiCommand::LoopReenter { deck } => Command::LoopReenter(deck.id()),
        UiCommand::Sync { deck } => {
            let pitch = state.sync_pitch(deck)?;
            let range = state.status.deck(deck.id()).pitch_range();
            if pitch.abs() > range {
                // Widen the pitch fader range so the match fits.
                let wider = [0.08, 0.16, 0.5]
                    .into_iter()
                    .find(|r| pitch.abs() <= *r)
                    .unwrap_or(0.5);
                state.send(Command::SetPitchRange {
                    deck: deck.id(),
                    range: wider,
                })?;
            }
            Command::SetPitch {
                deck: deck.id(),
                pitch,
            }
        }
        UiCommand::Crossfader { position } => Command::SetCrossfader(position),
        UiCommand::Master { db } => Command::SetMasterDb(db),
        UiCommand::LimiterCeiling { db } => Command::SetLimiterCeilingDb(db),
    })
}

#[tauri::command]
/// Volume controls stay usable while locked (if allowed); everything else is music.
pub fn lock_action(cmd: &UiCommand) -> Action {
    match cmd {
        UiCommand::Fader { .. } | UiCommand::Master { .. } => Action::Volume,
        _ => Action::Music,
    }
}

#[tauri::command]
pub fn engine_command(state: St<'_>, command: UiCommand) -> AppResult<()> {
    run_engine_command(&state, command)
}

pub fn run_engine_command(state: &AppState, command: UiCommand) -> AppResult<()> {
    state.lock_check(lock_action(&command))?;
    let c = to_engine(state, command)?;
    state.send(c)
}

/// The deck track's waveform (binary, see waveform.rs). Errors while it is still computing.
#[tauri::command]
pub fn deck_waveform(state: St<'_>, track_id: i64) -> AppResult<tauri::ipc::Response> {
    match state.waves.get(track_id) {
        Some(WaveState::Ready(bytes)) => Ok(tauri::ipc::Response::new(bytes.as_ref().clone())),
        Some(WaveState::Failed(e)) => Err(e),
        Some(WaveState::Computing) => Err("not ready".into()),
        None => Err("no waveform for this track".into()),
    }
}

// ----- Automix, LOCK, DUCK -----

fn clock_seconds() -> f64 {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
}

fn seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(1, |d| d.as_nanos() as u64)
}

#[tauri::command]
pub fn automix_start(state: St<'_>) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    state.automix_start()?;
    state.automix_tick(clock_seconds(), seed());
    Ok(())
}

#[tauri::command]
pub fn automix_stop(state: St<'_>) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    state.automix_stop();
    Ok(())
}

#[tauri::command]
pub fn automix_skip(state: St<'_>) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    state.automix_skip(clock_seconds(), seed())
}

#[tauri::command]
pub async fn automix_config(state: St<'_>, config: AutomixConfig) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| s.automix_set_config(config)).await
}

/// Master transport: PLAY starts Automix (or resumes a paused deck), PAUSE pauses the
/// playing decks, STOP stops Automix and both decks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MasterAction {
    Play,
    Pause,
    Stop,
}

#[tauri::command]
pub fn master_transport(state: St<'_>, action: MasterAction) -> AppResult<()> {
    state.lock_check(Action::Music)?;
    match action {
        MasterAction::Play => {
            let paused = [DeckName::A, DeckName::B].into_iter().find(|d| {
                let st = state.status.deck(d.id());
                st.is_loaded() && !st.is_playing() && !st.has_ended() && st.position() > 0.0
            });
            match paused {
                Some(d) => state.send(engine::Command::Play(d.id()))?,
                None => {
                    state.automix_start()?;
                    state.automix_tick(clock_seconds(), seed());
                }
            }
        }
        MasterAction::Pause => {
            for d in [DeckName::A, DeckName::B] {
                state.send(engine::Command::Pause(d.id()))?;
            }
        }
        MasterAction::Stop => {
            state.automix_stop();
            for d in [DeckName::A, DeckName::B] {
                state.send(engine::Command::Pause(d.id()))?;
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockInfo {
    pub locked: bool,
    pub volume_allowed: bool,
    pub hold_unlocks: bool,
    pub has_pin: bool,
}

#[tauri::command]
pub fn lock_info(state: St<'_>) -> LockInfo {
    let l = lock(&state.lock);
    LockInfo {
        locked: l.locked,
        volume_allowed: l.settings.volume_allowed,
        hold_unlocks: l.settings.hold_unlocks,
        has_pin: l.settings.pin_hash.is_some(),
    }
}

#[tauri::command]
pub async fn lock_engage(state: St<'_>) -> AppResult<()> {
    blocking(&state, |s| s.lock_engage()).await
}

#[tauri::command]
pub async fn lock_release(state: St<'_>, pin: Option<String>, hold: bool) -> AppResult<()> {
    blocking(&state, move |s| s.lock_release(pin.as_deref(), hold)).await
}

/// Lock options. `newPin`: omit to keep the PIN, "" to remove it, digits to set it.
#[tauri::command]
pub async fn lock_configure(
    state: St<'_>,
    volume_allowed: bool,
    hold_unlocks: bool,
    current_pin: Option<String>,
    new_pin: Option<String>,
) -> AppResult<()> {
    blocking(&state, move |s| {
        if lock(&s.lock).locked {
            return Err("Unlock first to change the lock settings".into());
        }
        let change = new_pin
            .as_deref()
            .map(|p| if p.is_empty() { None } else { Some(p) });
        s.lock_configure(volume_allowed, hold_unlocks, current_pin.as_deref(), change)
    })
    .await
}

pub const DUCK_DEPTH_KEY: &str = "duck.depth_db";

#[tauri::command]
pub async fn duck(state: St<'_>, on: bool) -> AppResult<()> {
    state.lock_check(Action::Volume)?;
    blocking(&state, move |s| {
        let depth = lock(&s.library)
            .setting(DUCK_DEPTH_KEY)
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(12.0);
        lock(&s.automix).duck_on = on;
        s.send(engine::Command::SetDuck {
            on,
            depth_db: depth,
        })
    })
    .await
}

#[tauri::command]
pub async fn duck_depth(state: St<'_>, db: f32) -> AppResult<()> {
    blocking(&state, move |s| {
        let d = db.clamp(3.0, 40.0);
        lock(&s.library)
            .set_setting(DUCK_DEPTH_KEY, &d.to_string())
            .map_err(err)?;
        let on = lock(&s.automix).duck_on;
        s.send(engine::Command::SetDuck { on, depth_db: d })
    })
    .await
}

// ----- radio -----

/// Stations offered ready-made. Addresses checked on 2026-10-10 (see CHANGELOG).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub name: &'static str,
    pub url: &'static str,
}

pub const PRESETS: [Preset; 2] = [
    Preset {
        name: "Bravo (Live)",
        url: "https://relay1.social3.hr/radio/8310/radio.mp3",
    },
    Preset {
        name: "Radio Dalmacija",
        url: "http://shoutcast.pondi.hr:8000/listen.pls",
    },
];

#[tauri::command]
pub fn radio_presets() -> Vec<Preset> {
    PRESETS.to_vec()
}

#[tauri::command]
pub async fn stations_list(state: St<'_>) -> AppResult<Vec<StationRow>> {
    blocking(&state, |s| lock(&s.library).stations().map_err(err)).await
}

#[tauri::command]
pub async fn station_save(
    state: St<'_>,
    id: Option<i64>,
    name: String,
    url: String,
    play_minutes: u32,
) -> AppResult<i64> {
    blocking(&state, move |s| {
        lock(&s.library)
            .save_station(id, &name, &url, play_minutes)
            .map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn station_delete(state: St<'_>, id: i64) -> AppResult<()> {
    blocking(&state, move |s| {
        lock(&s.library).delete_station(id).map_err(err)?;
        let mut q = lock(&s.queue);
        let gone: Vec<u64> = q
            .items()
            .iter()
            .filter(|i| i.station_id == Some(id))
            .map(|i| i.uid)
            .collect();
        q.remove(&gone);
        Ok(())
    })
    .await
}

/// Connects to an address and decodes a moment of audio (plays nothing). Returns the
/// station's name / format, or the problem in plain words.
#[tauri::command]
pub async fn station_probe(url: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || radio::probe(&url).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn deck_load_station(state: St<'_>, deck: DeckName, id: i64) -> AppResult<TrackRow> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| s.load_saved_station(deck, id)).await
}

/// Loads an address typed in the Radio strip (not saved).
#[tauri::command]
pub async fn deck_load_url(
    state: St<'_>,
    deck: DeckName,
    url: String,
    name: Option<String>,
) -> AppResult<TrackRow> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| {
        let name = name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| url.clone());
        s.load_station(deck, None, &name, &url, 60)
    })
    .await
}

#[tauri::command]
pub async fn queue_add_station(
    state: St<'_>,
    id: i64,
    before: Option<u64>,
) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| {
        lock(&s.library).station(id).map_err(err)?;
        lock(&s.queue).add_station(id, before);
        s.queue_entries()
    })
    .await
}

// ----- output devices -----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

impl From<engine::output::DeviceInfo> for Device {
    fn from(d: engine::output::DeviceInfo) -> Self {
        Self {
            id: d.id,
            name: d.name,
            is_default: d.is_default,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevices {
    pub devices: Vec<Device>,
    pub current: Option<Device>,
    pub preferred: Option<String>,
    pub sample_rate: u32,
}

#[tauri::command]
pub fn output_devices(state: St<'_>) -> AppResult<OutputDevices> {
    let o = state
        .output_state
        .as_ref()
        .ok_or("audio output is not running")?;
    Ok(OutputDevices {
        devices: o.devices().into_iter().map(Device::from).collect(),
        current: o.current_device().map(Device::from),
        preferred: o.preferred_device(),
        sample_rate: state.status.sample_rate(),
    })
}

/// Chooses (or clears) the preferred output device and remembers it.
#[tauri::command]
pub async fn set_preferred_output(state: St<'_>, id: Option<String>) -> AppResult<()> {
    blocking(&state, move |s| {
        if let Some(sup) = lock(&s.output).as_ref() {
            sup.set_preferred(id.clone());
        }
        lock(&s.library)
            .set_setting(crate::PREFERRED_OUTPUT_KEY, id.as_deref().unwrap_or(""))
            .map_err(err)
    })
    .await
}

// ----- Automix queue -----

#[tauri::command]
pub async fn queue_list(state: St<'_>) -> AppResult<Vec<QueueEntry>> {
    blocking(&state, |s| s.queue_entries()).await
}

#[tauri::command]
pub async fn queue_add(
    state: St<'_>,
    track_ids: Vec<i64>,
    before: Option<u64>,
) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| {
        lock(&s.queue).add(&track_ids, before);
        s.queue_entries()
    })
    .await
}

#[tauri::command]
pub async fn queue_add_paths(
    state: St<'_>,
    paths: Vec<PathBuf>,
    before: Option<u64>,
) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| {
        s.queue_add_paths(&paths, before)?;
        s.queue_entries()
    })
    .await
}

#[tauri::command]
pub async fn queue_move(
    state: St<'_>,
    uids: Vec<u64>,
    before: Option<u64>,
) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| {
        lock(&s.queue).move_items(&uids, before);
        s.queue_entries()
    })
    .await
}

#[tauri::command]
pub async fn queue_remove(state: St<'_>, uids: Vec<u64>) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, move |s| {
        lock(&s.queue).remove(&uids);
        s.queue_entries()
    })
    .await
}

#[tauri::command]
pub async fn queue_clear(state: St<'_>) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, |s| {
        lock(&s.queue).clear();
        s.queue_entries()
    })
    .await
}

#[tauri::command]
pub async fn queue_shuffle(state: St<'_>) -> AppResult<Vec<QueueEntry>> {
    state.lock_check(Action::Music)?;
    blocking(&state, |s| {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(1, |d| d.as_nanos() as u64);
        lock(&s.queue).shuffle(seed);
        s.queue_entries()
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_name_and_crate_version() {
        let info = app_info_value();
        assert_eq!(info.name, "BongPlayer");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn ui_commands_parse_from_json() {
        let c: UiCommand = serde_json::from_str(r#"{"type":"eq","deck":"A","band":"low","db":-6}"#)
            .expect("parse");
        assert_eq!(
            c,
            UiCommand::Eq {
                deck: DeckName::A,
                band: BandName::Low,
                db: -6.0
            }
        );
        let c: UiCommand =
            serde_json::from_str(r#"{"type":"keyLock","deck":"B","on":true}"#).expect("parse");
        assert_eq!(
            c,
            UiCommand::KeyLock {
                deck: DeckName::B,
                on: true
            }
        );
        assert!(serde_json::from_str::<UiCommand>(r#"{"type":"nope"}"#).is_err());
    }
}
