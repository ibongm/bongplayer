//! The library database (SQLite): tag cache, analysis results, crates & playlists, hot cues,
//! settings.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::tags::{read_tags, Tags};

/// One track as shown in the table.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRow {
    pub id: i64,
    pub path: PathBuf,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub remix: String,
    pub genre: String,
    pub year: Option<i32>,
    pub duration_ms: Option<u64>,
    /// Effective BPM: manual override, else analysed, else from the tags.
    pub bpm: Option<f64>,
    /// Effective key (Camelot notation, e.g. "8A"): override, analysed, or tag.
    pub key: Option<String>,
    pub bpm_is_manual: bool,
    pub rating: u8,
    pub play_count: u32,
    pub last_played: Option<i64>,
    pub first_seen: i64,
    pub has_cover: bool,
    pub analyzed: bool,
    /// The file was not found at the last check.
    pub missing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CrateKind {
    /// A set of tracks (no duplicates, no meaningful order).
    Crate,
    /// An ordered list; the same track may appear twice.
    Playlist,
}

impl CrateKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Crate => "crate",
            Self::Playlist => "playlist",
        }
    }
    fn parse(s: &str) -> Self {
        if s == "playlist" {
            Self::Playlist
        } else {
            Self::Crate
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrateInfo {
    pub id: i64,
    pub name: String,
    pub kind: CrateKind,
    pub track_count: u32,
}

#[derive(Debug)]
pub enum LibraryError {
    Db(rusqlite::Error),
    /// The path cannot be stored (not valid Unicode).
    BadPath(PathBuf),
    NotFound(String),
    Invalid(String),
}

impl std::fmt::Display for LibraryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db(e) => write!(f, "library database error: {e}"),
            Self::BadPath(p) => write!(f, "unsupported file name: {}", p.display()),
            Self::NotFound(what) => write!(f, "not found: {what}"),
            Self::Invalid(why) => f.write_str(why),
        }
    }
}

impl std::error::Error for LibraryError {}

impl From<rusqlite::Error> for LibraryError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e)
    }
}

pub type Result<T> = std::result::Result<T, LibraryError>;

/// How many files a folder scan read from disk vs. served from the cache.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub cached: usize,
    pub read: usize,
}

pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

pub(crate) fn path_str(p: &Path) -> Result<&str> {
    p.to_str()
        .ok_or_else(|| LibraryError::BadPath(p.to_path_buf()))
}

fn file_stamp(p: &Path) -> Option<(i64, i64)> {
    let md = std::fs::metadata(p).ok()?;
    let mtime = md
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    Some((md.len() as i64, mtime))
}

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (
    id            INTEGER PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    folder        TEXT NOT NULL,
    file_size     INTEGER NOT NULL,
    file_mtime    INTEGER NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    artist        TEXT NOT NULL DEFAULT '',
    album         TEXT NOT NULL DEFAULT '',
    remix         TEXT NOT NULL DEFAULT '',
    genre         TEXT NOT NULL DEFAULT '',
    year          INTEGER,
    duration_ms   INTEGER,
    tag_bpm       REAL,
    tag_key       TEXT,
    has_cover     INTEGER NOT NULL DEFAULT 0,
    bpm           REAL,
    musical_key   TEXT,
    analyzed_at   INTEGER,
    bpm_override  REAL,
    key_override  TEXT,
    rating        INTEGER NOT NULL DEFAULT 0,
    play_count    INTEGER NOT NULL DEFAULT 0,
    last_played   INTEGER,
    first_seen    INTEGER NOT NULL,
    missing       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tracks_folder ON tracks(folder);
CREATE TABLE IF NOT EXISTS crates (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('crate', 'playlist')),
    created  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crate_tracks (
    crate_id  INTEGER NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    PRIMARY KEY (crate_id, position)
);
CREATE INDEX IF NOT EXISTS crate_tracks_track ON crate_tracks(track_id);
CREATE TABLE IF NOT EXISTS hot_cues (
    track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    slot      INTEGER NOT NULL,
    frame     REAL NOT NULL,
    PRIMARY KEY (track_id, slot)
);
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"#;

const ROW_COLUMNS: &str = "id, path, title, artist, album, remix, genre, year, duration_ms, \
    tag_bpm, tag_key, bpm, musical_key, bpm_override, key_override, rating, play_count, \
    last_played, first_seen, has_cover, analyzed_at, missing";

fn row_from(r: &Row<'_>) -> rusqlite::Result<TrackRow> {
    row_from_offset(r, 0)
}

pub struct Library {
    conn: Connection,
}

impl Library {
    /// Opens (or creates) the library database at `path`.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Self::init(conn)
    }

    /// A throw-away database (tests, browser-only mode).
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // ----- tracks -----

    fn upsert(&self, path: &Path, size: i64, mtime: i64, t: &Tags) -> Result<i64> {
        let p = path_str(path)?;
        let folder = path.parent().and_then(Path::to_str).unwrap_or("");
        self.conn.execute(
            "INSERT INTO tracks (path, folder, file_size, file_mtime, title, artist, album, remix,
                genre, year, duration_ms, tag_bpm, tag_key, has_cover, first_seen, missing)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0)
             ON CONFLICT(path) DO UPDATE SET
                folder = excluded.folder, file_size = excluded.file_size,
                file_mtime = excluded.file_mtime, title = excluded.title,
                artist = excluded.artist, album = excluded.album, remix = excluded.remix,
                genre = excluded.genre, year = excluded.year, duration_ms = excluded.duration_ms,
                tag_bpm = excluded.tag_bpm, tag_key = excluded.tag_key,
                has_cover = excluded.has_cover, missing = 0",
            params![
                p,
                folder,
                size,
                mtime,
                t.title.as_deref().unwrap_or(""),
                t.artist.as_deref().unwrap_or(""),
                t.album.as_deref().unwrap_or(""),
                t.remix.as_deref().unwrap_or(""),
                t.genre.as_deref().unwrap_or(""),
                t.year,
                t.duration_ms.map(|d| d as i64),
                t.bpm,
                t.key,
                t.has_cover as i64,
                now(),
            ],
        )?;
        Ok(self
            .conn
            .query_row("SELECT id FROM tracks WHERE path = ?1", [p], |r| r.get(0))?)
    }

    /// Returns rows for `paths` (in the same order), reading tags only for files that are new
    /// or changed since they were cached. Files that cannot be stored are skipped.
    pub fn tracks_for_paths(&self, paths: &[PathBuf]) -> Result<(Vec<TrackRow>, ScanStats)> {
        let mut stats = ScanStats::default();
        // Decide what needs reading.
        let mut stamps = Vec::with_capacity(paths.len());
        let mut to_read = Vec::new();
        {
            let mut q = self
                .conn
                .prepare_cached("SELECT file_size, file_mtime FROM tracks WHERE path = ?1")?;
            for p in paths {
                let Ok(ps) = path_str(p) else {
                    stamps.push(None);
                    continue;
                };
                let stamp = file_stamp(p);
                let cached: Option<(i64, i64)> = q
                    .query_row([ps], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()?;
                match (stamp, cached) {
                    (Some(s), Some(c)) if s == c => stats.cached += 1,
                    (Some(_), _) => to_read.push(p.clone()),
                    (None, Some(_)) => {
                        self.conn
                            .execute("UPDATE tracks SET missing = 1 WHERE path = ?1", [ps])?;
                    }
                    (None, None) => {}
                }
                stamps.push(stamp);
            }
        }
        // Read tags in parallel, write sequentially in one transaction.
        let read: Vec<(PathBuf, Tags)> = to_read
            .par_iter()
            .map(|p| (p.clone(), read_tags(p)))
            .collect();
        stats.read = read.len();
        if !read.is_empty() {
            self.conn.execute_batch("BEGIN")?;
            for (p, t) in &read {
                if let Some((size, mtime)) = file_stamp(p) {
                    if let Err(e) = self.upsert(p, size, mtime, t) {
                        let _ = self.conn.execute_batch("ROLLBACK");
                        return Err(e);
                    }
                }
            }
            self.conn.execute_batch("COMMIT")?;
        }
        let mut rows = Vec::with_capacity(paths.len());
        let mut q = self
            .conn
            .prepare_cached(&format!("SELECT {ROW_COLUMNS} FROM tracks WHERE path = ?1"))?;
        for p in paths {
            let Ok(ps) = path_str(p) else { continue };
            if let Some(row) = q.query_row([ps], row_from).optional()? {
                rows.push(row);
            }
        }
        Ok((rows, stats))
    }

    /// Every track the library has seen (the "Music Library" view).
    pub fn all_tracks(&self) -> Result<Vec<TrackRow>> {
        let mut q = self.conn.prepare_cached(&format!(
            "SELECT {ROW_COLUMNS} FROM tracks ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE"
        ))?;
        let rows = q
            .query_map([], row_from)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn track(&self, id: i64) -> Result<TrackRow> {
        self.conn
            .query_row(
                &format!("SELECT {ROW_COLUMNS} FROM tracks WHERE id = ?1"),
                [id],
                row_from,
            )
            .optional()?
            .ok_or_else(|| LibraryError::NotFound(format!("track {id}")))
    }

    pub fn tracks_by_ids(&self, ids: &[i64]) -> Result<Vec<TrackRow>> {
        let mut out = Vec::with_capacity(ids.len());
        for &id in ids {
            if let Ok(row) = self.track(id) {
                out.push(row);
            }
        }
        Ok(out)
    }

    pub fn track_count(&self) -> Result<u64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get::<_, i64>(0))?
            .max(0) as u64)
    }

    fn update_ids(&self, sql: &str, ids: &[i64]) -> Result<usize> {
        let mut n = 0;
        let mut q = self.conn.prepare_cached(sql)?;
        for &id in ids {
            n += q.execute([id])?;
        }
        Ok(n)
    }

    /// Counts a play: play count +1, last played = now.
    pub fn mark_played(&self, ids: &[i64]) -> Result<usize> {
        let t = now();
        let mut n = 0;
        let mut q = self.conn.prepare_cached(
            "UPDATE tracks SET play_count = play_count + 1, last_played = ?2 WHERE id = ?1",
        )?;
        for &id in ids {
            n += q.execute(params![id, t])?;
        }
        Ok(n)
    }

    /// Removes tracks from the library (not from disk). Their crate entries and cues go too.
    pub fn remove_tracks(&self, ids: &[i64]) -> Result<usize> {
        self.update_ids("DELETE FROM tracks WHERE id = ?1", ids)
    }

    pub fn set_rating(&self, ids: &[i64], rating: u8) -> Result<usize> {
        let mut n = 0;
        let mut q = self
            .conn
            .prepare_cached("UPDATE tracks SET rating = ?2 WHERE id = ?1")?;
        for &id in ids {
            n += q.execute(params![id, i64::from(rating.min(5))])?;
        }
        Ok(n)
    }

    /// Manual BPM (TAP or typed). `None` clears it.
    pub fn set_bpm_override(&self, ids: &[i64], bpm: Option<f64>) -> Result<usize> {
        if bpm.is_some_and(|b| !(20.0..400.0).contains(&b)) {
            return Err(LibraryError::Invalid(
                "BPM must be between 20 and 400".into(),
            ));
        }
        let mut n = 0;
        let mut q = self
            .conn
            .prepare_cached("UPDATE tracks SET bpm_override = ?2 WHERE id = ?1")?;
        for &id in ids {
            n += q.execute(params![id, bpm])?;
        }
        Ok(n)
    }

    pub fn save_analysis(&self, id: i64, bpm: Option<f64>, key: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE tracks SET bpm = ?2, musical_key = ?3, analyzed_at = ?4 WHERE id = ?1",
            params![id, bpm, key, now()],
        )?;
        Ok(())
    }

    // ----- crates & playlists -----

    pub fn create_crate(&self, name: &str, kind: CrateKind) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err(LibraryError::Invalid("name must not be empty".into()));
        }
        self.conn.execute(
            "INSERT INTO crates (name, kind, created) VALUES (?1, ?2, ?3)",
            params![name, kind.as_str(), now()],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn rename_crate(&self, id: i64, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(LibraryError::Invalid("name must not be empty".into()));
        }
        let n = self.conn.execute(
            "UPDATE crates SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;
        if n == 0 {
            return Err(LibraryError::NotFound(format!("crate {id}")));
        }
        Ok(())
    }

    pub fn delete_crate(&self, id: i64) -> Result<()> {
        let n = self
            .conn
            .execute("DELETE FROM crates WHERE id = ?1", [id])?;
        if n == 0 {
            return Err(LibraryError::NotFound(format!("crate {id}")));
        }
        Ok(())
    }

    pub fn crates(&self) -> Result<Vec<CrateInfo>> {
        let mut q = self.conn.prepare_cached(
            "SELECT c.id, c.name, c.kind, COUNT(ct.track_id) FROM crates c
             LEFT JOIN crate_tracks ct ON ct.crate_id = c.id
             GROUP BY c.id ORDER BY c.kind, c.name COLLATE NOCASE",
        )?;
        let rows = q
            .query_map([], |r| {
                Ok(CrateInfo {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: CrateKind::parse(&r.get::<_, String>(2)?),
                    track_count: r.get::<_, i64>(3)?.max(0) as u32,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    fn crate_kind(&self, id: i64) -> Result<CrateKind> {
        let kind: Option<String> = self
            .conn
            .query_row("SELECT kind FROM crates WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        kind.map(|k| CrateKind::parse(&k))
            .ok_or_else(|| LibraryError::NotFound(format!("crate {id}")))
    }

    /// Adds tracks at the end. A crate ignores tracks it already holds. Returns how many
    /// were added.
    pub fn add_to_crate(&self, crate_id: i64, track_ids: &[i64]) -> Result<usize> {
        let kind = self.crate_kind(crate_id)?;
        let mut next: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM crate_tracks WHERE crate_id = ?1",
            [crate_id],
            |r| r.get(0),
        )?;
        let mut added = 0;
        self.conn.execute_batch("BEGIN")?;
        let result = (|| -> Result<()> {
            for &tid in track_ids {
                if kind == CrateKind::Crate {
                    let exists: bool = self.conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM crate_tracks WHERE crate_id = ?1 AND track_id = ?2)",
                        params![crate_id, tid],
                        |r| r.get(0),
                    )?;
                    if exists {
                        continue;
                    }
                }
                self.conn.execute(
                    "INSERT INTO crate_tracks (crate_id, position, track_id) VALUES (?1, ?2, ?3)",
                    params![crate_id, next, tid],
                )?;
                next += 1;
                added += 1;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(added)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    /// Removes entries at the given positions.
    pub fn remove_from_crate(&self, crate_id: i64, positions: &[i64]) -> Result<usize> {
        let mut n = 0;
        for &p in positions {
            n += self.conn.execute(
                "DELETE FROM crate_tracks WHERE crate_id = ?1 AND position = ?2",
                params![crate_id, p],
            )?;
        }
        Ok(n)
    }

    /// Tracks in a crate/playlist in order, with their positions.
    pub fn crate_tracks(&self, crate_id: i64) -> Result<Vec<(i64, TrackRow)>> {
        self.crate_kind(crate_id)?;
        let cols = ROW_COLUMNS
            .split(", ")
            .map(|c| format!("t.{}", c.trim()))
            .collect::<Vec<_>>()
            .join(", ");
        let mut q = self.conn.prepare_cached(&format!(
            "SELECT ct.position, {cols} FROM crate_tracks ct JOIN tracks t ON t.id = ct.track_id
             WHERE ct.crate_id = ?1 ORDER BY ct.position"
        ))?;
        let rows = q
            .query_map([crate_id], |r| {
                let pos: i64 = r.get(0)?;
                Ok((pos, row_from_offset(r, 1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    // ----- hot cues -----

    pub fn set_hot_cue(&self, track_id: i64, slot: u8, frame: f64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO hot_cues (track_id, slot, frame) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id, slot) DO UPDATE SET frame = excluded.frame",
            params![track_id, i64::from(slot), frame],
        )?;
        Ok(())
    }

    pub fn clear_hot_cue(&self, track_id: i64, slot: u8) -> Result<()> {
        self.conn.execute(
            "DELETE FROM hot_cues WHERE track_id = ?1 AND slot = ?2",
            params![track_id, i64::from(slot)],
        )?;
        Ok(())
    }

    /// Hot cues of a track as (slot, frame).
    pub fn hot_cues(&self, track_id: i64) -> Result<Vec<(u8, f64)>> {
        let mut q = self
            .conn
            .prepare_cached("SELECT slot, frame FROM hot_cues WHERE track_id = ?1 ORDER BY slot")?;
        let rows = q
            .query_map([track_id], |r| {
                Ok((r.get::<_, i64>(0)?.clamp(0, 255) as u8, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    // ----- settings -----

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Ids for paths already in the library (missing ones are skipped).
    pub fn ids_for_paths(&self, paths: &[PathBuf]) -> Result<Vec<i64>> {
        let strs: Vec<&str> = paths.iter().filter_map(|p| p.to_str()).collect();
        let mut out = Vec::with_capacity(strs.len());
        for chunk in strs.chunks(500) {
            let marks = vec!["?"; chunk.len()].join(",");
            let mut q = self.conn.prepare(&format!(
                "SELECT id, path FROM tracks WHERE path IN ({marks})"
            ))?;
            let found: Vec<(i64, String)> = q
                .query_map(params_from_iter(chunk.iter()), |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?
                .collect::<rusqlite::Result<_>>()?;
            for s in chunk {
                if let Some((id, _)) = found.iter().find(|(_, p)| p == s) {
                    out.push(*id);
                }
            }
        }
        Ok(out)
    }
}

/// `row_from` for queries where the track columns start at `offset`.
fn row_from_offset(r: &Row<'_>, offset: usize) -> rusqlite::Result<TrackRow> {
    let g = |i: usize| i + offset;
    let tag_bpm: Option<f64> = r.get(g(9))?;
    let tag_key: Option<String> = r.get(g(10))?;
    let bpm: Option<f64> = r.get(g(11))?;
    let key: Option<String> = r.get(g(12))?;
    let bpm_override: Option<f64> = r.get(g(13))?;
    let key_override: Option<String> = r.get(g(14))?;
    let path: String = r.get(g(1))?;
    Ok(TrackRow {
        id: r.get(g(0))?,
        path: PathBuf::from(path),
        title: r.get(g(2))?,
        artist: r.get(g(3))?,
        album: r.get(g(4))?,
        remix: r.get(g(5))?,
        genre: r.get(g(6))?,
        year: r.get(g(7))?,
        duration_ms: r.get::<_, Option<i64>>(g(8))?.map(|d| d.max(0) as u64),
        bpm_is_manual: bpm_override.is_some(),
        bpm: bpm_override.or(bpm).or(tag_bpm),
        key: key_override.or(key).or(tag_key),
        rating: r.get::<_, i64>(g(15))?.clamp(0, 5) as u8,
        play_count: r.get::<_, i64>(g(16))?.max(0) as u32,
        last_played: r.get(g(17))?,
        first_seen: r.get(g(18))?,
        has_cover: r.get::<_, i64>(g(19))? != 0,
        analyzed: r.get::<_, Option<i64>>(g(20))?.is_some(),
        missing: r.get::<_, i64>(g(21))? != 0,
    })
}
