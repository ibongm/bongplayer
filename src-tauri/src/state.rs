//! Application state shared by all commands, and the logic behind them (kept free of Tauri
//! types so it can be unit-tested).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use engine::deck::HOT_CUES;
use engine::live::LiveBuffer;
use engine::output::{OutputState, OutputSupervisor};
use engine::{Command, DeckId, EngineHandle, EngineStatus, TrackBuffer};
use library::browse::audio_files_recursive;
use library::{Library, StationRow, TrackRow};
use serde::{Deserialize, Serialize};

use crate::automix::Automix;
use crate::lock::LockState;
use crate::waveform::WaveCache;

/// Most files one folder drop may add (protects against dropping a whole drive).
pub const MAX_FOLDER_FILES: usize = 5_000;

/// Error text shown to the user.
pub type AppResult<T> = Result<T, String>;

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding a lock must not take the whole app down: keep using the data.
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// "A" / "B" in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeckName {
    A,
    B,
}

impl DeckName {
    pub fn id(self) -> DeckId {
        match self {
            Self::A => DeckId::A,
            Self::B => DeckId::B,
        }
    }
    pub fn index(self) -> usize {
        self.id() as usize
    }
}

/// A station playing on a deck.
#[derive(Debug, Clone)]
pub struct LiveDeck {
    pub live: Arc<LiveBuffer>,
    /// Saved station, if it is one (an address typed in the Radio strip has none).
    pub station_id: Option<i64>,
    pub name: String,
    pub url: String,
    /// Automix plays a station this long before moving on.
    pub play_minutes: u32,
}

#[derive(Debug, Clone)]
pub enum DeckSource {
    File {
        buffer: Arc<TrackBuffer>,
        expected_frames: Option<u64>,
    },
    Live(LiveDeck),
}

/// What is on a deck, as the app knows it.
#[derive(Debug, Clone)]
pub struct DeckTrack {
    pub row: TrackRow,
    pub source: DeckSource,
}

impl DeckTrack {
    pub fn sample_rate(&self) -> u32 {
        match &self.source {
            DeckSource::File { buffer, .. } => buffer.sample_rate().max(1),
            DeckSource::Live(l) => l.live.sample_rate().max(1),
        }
    }

    pub fn file(&self) -> Option<&Arc<TrackBuffer>> {
        match &self.source {
            DeckSource::File { buffer, .. } => Some(buffer),
            DeckSource::Live(_) => None,
        }
    }

    pub fn live(&self) -> Option<&LiveDeck> {
        match &self.source {
            DeckSource::Live(l) => Some(l),
            DeckSource::File { .. } => None,
        }
    }

    /// Length in frames: decoded length, or what the container announced while decoding.
    pub fn total_frames(&self) -> Option<u64> {
        match &self.source {
            DeckSource::File {
                buffer,
                expected_frames,
            } => buffer.total_frames().or(*expected_frames),
            DeckSource::Live(_) => None,
        }
    }
}

/// A table row standing in for a station (decks and the queue show tracks).
pub fn station_row(id: Option<i64>, name: &str, url: &str, play_minutes: u32) -> TrackRow {
    TrackRow {
        id: -id.unwrap_or(0).abs() - 1,
        path: PathBuf::from(url),
        title: name.to_string(),
        artist: "Internet radio".into(),
        album: String::new(),
        remix: String::new(),
        genre: String::new(),
        year: None,
        duration_ms: Some(u64::from(play_minutes) * 60_000),
        bpm: None,
        key: None,
        bpm_is_manual: false,
        rating: 0,
        play_count: 0,
        last_played: None,
        first_seen: 0,
        has_cover: false,
        analyzed: false,
        missing: false,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    /// Unique per queue entry (the same track may be queued twice).
    pub uid: u64,
    pub track_id: i64,
    /// Set for a radio station entry (then `track_id` is not used).
    #[serde(default)]
    pub station_id: Option<i64>,
}

/// The Automix queue.
#[derive(Debug, Default)]
pub struct Queue {
    items: Vec<QueueItem>,
    next_uid: u64,
}

impl Queue {
    pub fn items(&self) -> &[QueueItem] {
        &self.items
    }

    /// Replaces the queue with saved entries (resume after a restart).
    pub fn restore(&mut self, items: Vec<QueueItem>) {
        self.next_uid = items.iter().map(|i| i.uid).max().unwrap_or(0);
        self.items = items;
    }

    fn index_of(&self, uid: u64) -> Option<usize> {
        self.items.iter().position(|i| i.uid == uid)
    }

    /// Inserts tracks before the entry `before` (or at the end). Returns the new uids.
    pub fn add(&mut self, track_ids: &[i64], before: Option<u64>) -> Vec<u64> {
        let at = before
            .and_then(|b| self.index_of(b))
            .unwrap_or(self.items.len());
        let new: Vec<QueueItem> = track_ids
            .iter()
            .map(|&track_id| {
                self.next_uid += 1;
                QueueItem {
                    uid: self.next_uid,
                    track_id,
                    station_id: None,
                }
            })
            .collect();
        let uids = new.iter().map(|i| i.uid).collect();
        self.items.splice(at..at, new);
        uids
    }

    /// Inserts a radio station before `before` (or at the end). Returns its uid.
    pub fn add_station(&mut self, station_id: i64, before: Option<u64>) -> u64 {
        let at = before
            .and_then(|b| self.index_of(b))
            .unwrap_or(self.items.len());
        self.next_uid += 1;
        self.items.insert(
            at,
            QueueItem {
                uid: self.next_uid,
                track_id: 0,
                station_id: Some(station_id),
            },
        );
        self.next_uid
    }

    /// Moves entries (keeping their order) to just before `before`, or to the end.
    pub fn move_items(&mut self, uids: &[u64], before: Option<u64>) {
        let (moving, mut rest): (Vec<QueueItem>, Vec<QueueItem>) =
            self.items.drain(..).partition(|i| uids.contains(&i.uid));
        let at = before
            .and_then(|b| rest.iter().position(|i| i.uid == b))
            .unwrap_or(rest.len());
        rest.splice(at..at, moving);
        self.items = rest;
    }

    pub fn remove(&mut self, uids: &[u64]) -> usize {
        let before = self.items.len();
        self.items.retain(|i| !uids.contains(&i.uid));
        before - self.items.len()
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    /// Shuffles with a simple deterministic generator seeded by `seed`.
    pub fn shuffle(&mut self, seed: u64) {
        let mut s = seed | 1;
        for i in (1..self.items.len()).rev() {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let j = (s % (i as u64 + 1)) as usize;
            self.items.swap(i, j);
        }
    }

    /// Removes and returns the first entry.
    pub fn pop_front(&mut self) -> Option<QueueItem> {
        (!self.items.is_empty()).then(|| self.items.remove(0))
    }
}

pub struct AppState {
    pub db_path: PathBuf,
    pub library: Mutex<Library>,
    pub engine: Mutex<EngineHandle>,
    pub status: Arc<EngineStatus>,
    pub output: Mutex<Option<OutputSupervisor>>,
    pub output_state: Option<Arc<OutputState>>,
    pub decks: Mutex<[Option<DeckTrack>; 2]>,
    /// Running radio connections, per deck.
    pub radios: Mutex<[Option<radio::Station>; 2]>,
    pub queue: Mutex<Queue>,
    pub waves: Arc<WaveCache>,
    pub automix: Mutex<Automix>,
    pub lock: Mutex<LockState>,
}

/// A queue entry with its track, for display.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub uid: u64,
    pub track: TrackRow,
}

impl AppState {
    pub fn new(
        db_path: PathBuf,
        library: Library,
        engine: EngineHandle,
        output: Option<OutputSupervisor>,
    ) -> Self {
        let status = engine.status_arc();
        let output_state = output.as_ref().map(OutputSupervisor::state_arc);
        Self {
            db_path,
            library: Mutex::new(library),
            engine: Mutex::new(engine),
            status,
            output: Mutex::new(output),
            output_state,
            decks: Mutex::new([None, None]),
            radios: Mutex::new([None, None]),
            queue: Mutex::new(Queue::default()),
            waves: Arc::new(WaveCache::default()),
            automix: Mutex::new(Automix::default()),
            lock: Mutex::new(LockState::default()),
        }
    }

    pub fn send(&self, command: Command) -> AppResult<()> {
        lock(&self.engine).send(command).map_err(err)
    }

    /// Registers files with the library (reading tags if needed) and returns their rows.
    pub fn rows_for_paths(&self, paths: &[PathBuf]) -> AppResult<Vec<TrackRow>> {
        let (rows, _) = lock(&self.library).tracks_for_paths(paths).map_err(err)?;
        Ok(rows)
    }

    /// Expands dropped files and folders into audio files (folders recursively).
    pub fn expand_paths(paths: &[PathBuf]) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for p in paths {
            if p.is_dir() {
                out.extend(audio_files_recursive(
                    p,
                    MAX_FOLDER_FILES - out.len().min(MAX_FOLDER_FILES),
                ));
            } else if library::tags::is_audio(p) {
                out.push(p.clone());
            }
            if out.len() >= MAX_FOLDER_FILES {
                break;
            }
        }
        out
    }

    /// Loads a library track on a deck (stopped at the start) and restores its hot cues.
    pub fn load_track(&self, deck: DeckName, track_id: i64) -> AppResult<TrackRow> {
        let (row, cues) = {
            let lib = lock(&self.library);
            (
                lib.track(track_id).map_err(err)?,
                lib.hot_cues(track_id).map_err(err)?,
            )
        };
        let decoding = engine::start_decoding(&row.path).map_err(err)?;
        let buffer = Arc::clone(&decoding.buffer);
        {
            let mut engine = lock(&self.engine);
            engine.load(deck.id(), Arc::clone(&buffer)).map_err(err)?;
            for (slot, frame) in cues {
                engine
                    .send(Command::SetHotCueAt {
                        deck: deck.id(),
                        slot: usize::from(slot),
                        frame,
                    })
                    .map_err(err)?;
            }
        }
        self.waves.start(row.id, Arc::clone(&buffer));
        self.lookup_in_background(row.id);
        lock(&self.decks)[deck.index()] = Some(DeckTrack {
            row: row.clone(),
            source: DeckSource::File {
                buffer,
                expected_frames: decoding.expected_frames,
            },
        });
        self.stop_radio(deck);
        // The decoding thread keeps running on its own; dropping the handle detaches it.
        drop(decoding);
        Ok(row)
    }

    /// Loads a file (e.g. dropped from Windows Explorer) on a deck.
    pub fn load_path(&self, deck: DeckName, path: &Path) -> AppResult<TrackRow> {
        let rows = self.rows_for_paths(&[path.to_path_buf()])?;
        let row = rows
            .first()
            .ok_or_else(|| format!("not a playable audio file: {}", path.display()))?;
        self.load_track(deck, row.id)
    }

    /// Sample rate of what is on a deck (positions are converted between seconds and frames).
    pub fn file_rate(&self, deck: DeckName) -> Option<u32> {
        lock(&self.decks)[deck.index()]
            .as_ref()
            .map(DeckTrack::sample_rate)
    }

    /// Stops a deck's radio connection (if any), outside other locks.
    fn stop_radio(&self, deck: DeckName) {
        let old = lock(&self.radios)[deck.index()].take();
        drop(old);
    }

    /// Puts a radio station on a deck (stopped; press play). The connection starts at once.
    pub fn load_station(
        &self,
        deck: DeckName,
        station_id: Option<i64>,
        name: &str,
        url: &str,
        play_minutes: u32,
    ) -> AppResult<TrackRow> {
        let u = url.trim();
        if !(u.starts_with("http://") || u.starts_with("https://")) {
            return Err("a station address must start with http:// or https://".into());
        }
        let live = Arc::new(LiveBuffer::new(48_000));
        let station = radio::Station::start(u, Arc::clone(&live));
        lock(&self.engine)
            .load_live(deck.id(), Arc::clone(&live))
            .map_err(err)?;
        let row = station_row(station_id, name, u, play_minutes);
        self.stop_radio(deck);
        lock(&self.radios)[deck.index()] = Some(station);
        lock(&self.decks)[deck.index()] = Some(DeckTrack {
            row: row.clone(),
            source: DeckSource::Live(LiveDeck {
                live,
                station_id,
                name: name.to_string(),
                url: u.to_string(),
                play_minutes,
            }),
        });
        Ok(row)
    }

    pub fn load_saved_station(&self, deck: DeckName, station_id: i64) -> AppResult<TrackRow> {
        let st: StationRow = lock(&self.library).station(station_id).map_err(err)?;
        self.load_station(deck, Some(st.id), &st.name, &st.url, st.play_minutes)
    }

    /// Sets a hot cue at the current position and saves it with the track.
    pub fn set_hot_cue(&self, deck: DeckName, slot: usize) -> AppResult<()> {
        if slot >= HOT_CUES {
            return Err(format!("hot cue {} does not exist", slot + 1));
        }
        let track_id = lock(&self.decks)[deck.index()]
            .as_ref()
            .map(|d| d.row.id)
            .ok_or("no track loaded")?;
        let frame = self.status.deck(deck.id()).position();
        self.send(Command::SetHotCueAt {
            deck: deck.id(),
            slot,
            frame,
        })?;
        lock(&self.library)
            .set_hot_cue(track_id, slot as u8, frame)
            .map_err(err)
    }

    /// The internet lookup switch (OFF unless the user turned it on).
    pub fn internet_lookup_on(&self) -> bool {
        lock(&self.library)
            .setting(crate::INTERNET_LOOKUP_KEY)
            .ok()
            .flatten()
            .as_deref()
            == Some("1")
    }

    /// A separate database connection for slow background work (analysis, lookups), so the
    /// library stays responsive.
    pub fn background_library(&self) -> AppResult<Library> {
        let mut lib = Library::open(&self.db_path).map_err(err)?;
        if let Some(dir) = self.db_path.parent() {
            lib.set_covers_dir(dir.join("covers"));
        }
        Ok(lib)
    }

    /// Looks a track up online in the background if the switch is on (once per track).
    pub fn lookup_in_background(&self, track_id: i64) {
        if track_id <= 0 || !self.internet_lookup_on() {
            return;
        }
        let Ok(lib) = self.background_library() else {
            return;
        };
        let _ = std::thread::Builder::new()
            .name("bong-lookup".into())
            .spawn(move || {
                let _ = lib.lookup_track(track_id, &library::lookup::NetFetcher::default());
            });
    }

    /// Track BPM of the deck's track (analysed, tagged or manual).
    pub fn track_bpm(&self, deck: DeckName) -> Option<f64> {
        lock(&self.decks)[deck.index()]
            .as_ref()
            .and_then(|d| d.row.bpm)
    }

    /// Pitch that makes `deck` play at the other deck's current BPM. Half / double tempos
    /// are matched too (a 70 BPM track syncs to 140). Errors when it is out of ±50 %.
    pub fn sync_pitch(&self, deck: DeckName) -> AppResult<f64> {
        let other = if deck == DeckName::A {
            DeckName::B
        } else {
            DeckName::A
        };
        let mine = self
            .track_bpm(deck)
            .ok_or("SYNC needs this track's BPM (analyze it or use TAP)")?;
        let theirs = self
            .track_bpm(other)
            .ok_or("SYNC needs the other deck's BPM (analyze it or use TAP)")?
            * self.status.deck(other.id()).tempo();
        let mut target = theirs;
        while target / mine > 1.5 {
            target /= 2.0;
        }
        while target / mine < 0.75 {
            target *= 2.0;
        }
        let pitch = target / mine - 1.0;
        if pitch.abs() > 0.5 {
            return Err(format!(
                "SYNC would need {:+.1} % pitch (more than ±50 %)",
                pitch * 100.0
            ));
        }
        Ok(pitch)
    }

    pub fn clear_hot_cue(&self, deck: DeckName, slot: usize) -> AppResult<()> {
        let track_id = lock(&self.decks)[deck.index()].as_ref().map(|d| d.row.id);
        self.send(Command::ClearHotCue {
            deck: deck.id(),
            slot,
        })?;
        if let Some(id) = track_id {
            lock(&self.library)
                .clear_hot_cue(id, slot.min(255) as u8)
                .map_err(err)?;
        }
        Ok(())
    }

    // ----- queue -----

    pub fn queue_entries(&self) -> AppResult<Vec<QueueEntry>> {
        let items = lock(&self.queue).items().to_vec();
        let lib = lock(&self.library);
        Ok(items
            .into_iter()
            .filter_map(|i| match i.station_id {
                Some(sid) => lib.station(sid).ok().map(|st| QueueEntry {
                    uid: i.uid,
                    track: station_row(Some(st.id), &st.name, &st.url, st.play_minutes),
                }),
                None => lib
                    .track(i.track_id)
                    .ok()
                    .map(|track| QueueEntry { uid: i.uid, track }),
            })
            .collect())
    }

    pub fn queue_add_paths(&self, paths: &[PathBuf], before: Option<u64>) -> AppResult<usize> {
        let files = Self::expand_paths(paths);
        let rows = self.rows_for_paths(&files)?;
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        lock(&self.queue).add(&ids, before);
        Ok(ids.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uids(q: &Queue) -> Vec<i64> {
        q.items().iter().map(|i| i.track_id).collect()
    }

    #[test]
    fn queue_add_insert_move_remove() {
        let mut q = Queue::default();
        let a = q.add(&[1, 2, 3], None);
        assert_eq!(uids(&q), vec![1, 2, 3]);
        q.add(&[9], Some(a[1]));
        assert_eq!(uids(&q), vec![1, 9, 2, 3]);
        // Move track 3 to the front, then 1 and 9 to the end.
        q.move_items(&[a[2]], Some(a[0]));
        assert_eq!(uids(&q), vec![3, 1, 9, 2]);
        let nine = q.items()[2].uid;
        q.move_items(&[a[0], nine], None);
        assert_eq!(uids(&q), vec![3, 2, 1, 9]);
        assert_eq!(q.remove(&[a[1]]), 1);
        assert_eq!(uids(&q), vec![3, 1, 9]);
        assert_eq!(q.pop_front().map(|i| i.track_id), Some(3));
        q.clear();
        assert!(q.items().is_empty());
    }

    #[test]
    fn same_track_twice_has_two_uids() {
        let mut q = Queue::default();
        let u = q.add(&[5, 5], None);
        assert_ne!(u[0], u[1]);
        q.remove(&[u[0]]);
        assert_eq!(uids(&q), vec![5]);
    }

    #[test]
    fn shuffle_keeps_every_entry() {
        let mut q = Queue::default();
        q.add(&(0..50).collect::<Vec<_>>(), None);
        q.shuffle(42);
        let mut ids = uids(&q);
        assert_ne!(ids, (0..50).collect::<Vec<_>>());
        ids.sort_unstable();
        assert_eq!(ids, (0..50).collect::<Vec<_>>());
    }
}
