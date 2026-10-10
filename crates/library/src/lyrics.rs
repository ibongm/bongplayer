//! Lyrics for the karaoke view: the LRC format (timed lines), and finding lyrics for a track —
//! a `.lrc` file next to it, lyrics embedded in its tags, or LRCLIB (only when the internet
//! switch is on; one request per track, the answer is kept).

use std::path::{Path, PathBuf};

use lofty::prelude::*;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::{now, Library, Result};
use crate::lookup::{enc, Fetcher};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    /// Start of the line in milliseconds (0 for unsynced lyrics).
    pub ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LyricsSource {
    /// A `.lrc` file beside the audio file.
    File,
    /// Lyrics stored in the audio file's tags.
    Embedded,
    /// lrclib.net (internet lookup).
    Lrclib,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// Lines in time order.
    pub lines: Vec<LyricLine>,
    /// Lines carry times (karaoke highlighting works); otherwise plain text.
    pub synced: bool,
    pub source: LyricsSource,
    /// LRCLIB marked the track as instrumental (no lines).
    pub instrumental: bool,
}

/// `mm:ss`, `mm:ss.x`, `mm:ss.xx`, `mm:ss.xxx` or `mm:ss:xx` → milliseconds.
fn parse_time(tag: &str) -> Option<i64> {
    let (min, rest) = tag.split_once(':')?;
    if min.is_empty() || min.len() > 3 || !min.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (sec, frac) = match rest.find(['.', ':']) {
        Some(i) => (&rest[..i], Some(&rest[i + 1..])),
        None => (rest, None),
    };
    if sec.is_empty() || sec.len() > 2 || !sec.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut ms = min.parse::<i64>().ok()? * 60_000 + sec.parse::<i64>().ok()? * 1000;
    if let Some(f) = frac {
        if f.is_empty() || f.len() > 3 || !f.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        // ".5" = 500 ms, ".50" = 500 ms, ".500" = 500 ms.
        let scale = [100, 10, 1][f.len() - 1];
        ms += f.parse::<i64>().ok()? * scale;
    }
    Some(ms)
}

/// Removes word timings of "enhanced" LRC (`<00:12.34>`).
fn strip_word_times(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        match rest[start..].find('>') {
            Some(len) if parse_time(&rest[start + 1..start + len]).is_some() => {
                out.push_str(&rest[..start]);
                rest = &rest[start + len + 1..];
            }
            _ => {
                out.push_str(&rest[..=start]);
                rest = &rest[start + 1..];
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Parses LRC text. A line may carry several times (`[00:10.00][01:10.00]Chorus`); the
/// `[offset:+500]` tag moves every line (positive = shown earlier). Other tags (`[ar:…]`,
/// `[ti:…]` …) are ignored. Returns `None` when the text has no timed lines.
pub fn parse_lrc(text: &str) -> Option<Vec<LyricLine>> {
    let text = text.trim_start_matches('\u{feff}');
    let mut offset = 0i64;
    let mut lines = Vec::new();
    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut times = Vec::new();
        while let Some(body) = rest.strip_prefix('[') {
            let Some(end) = body.find(']') else { break };
            let tag = body[..end].trim();
            if let Some(t) = parse_time(tag) {
                times.push(t);
            } else if let Some(v) = tag
                .split_once(':')
                .filter(|(k, _)| k.trim().eq_ignore_ascii_case("offset"))
                .map(|(_, v)| v.trim())
            {
                offset = v.trim_start_matches('+').parse().unwrap_or(0);
            }
            rest = body[end + 1..].trim_start();
        }
        let line = strip_word_times(rest);
        for t in times {
            lines.push(LyricLine {
                ms: t,
                text: line.clone(),
            });
        }
    }
    if lines.is_empty() {
        return None;
    }
    for l in &mut lines {
        l.ms = (l.ms - offset).max(0);
    }
    // Stable: lines with the same time keep their order in the file.
    lines.sort_by_key(|l| l.ms);
    Some(lines)
}

/// Unsynced lyrics: one line per text line, no times. Tag-like lines are dropped.
fn plain_lines(text: &str) -> Vec<LyricLine> {
    text.trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .filter(|l| !(l.starts_with('[') && l.ends_with(']')))
        .skip_while(|l| l.is_empty())
        .map(|l| LyricLine {
            ms: 0,
            text: l.to_string(),
        })
        .collect()
}

fn from_text(text: &str, source: LyricsSource) -> Option<Lyrics> {
    if let Some(lines) = parse_lrc(text) {
        return Some(Lyrics {
            lines,
            synced: true,
            source,
            instrumental: false,
        });
    }
    let lines = plain_lines(text);
    (!lines.iter().all(|l| l.text.is_empty())).then_some(Lyrics {
        lines,
        synced: false,
        source,
        instrumental: false,
    })
}

/// The `.lrc` file beside an audio file (same name; `.lrc` in any letter case).
pub fn lrc_file(path: &Path) -> Option<PathBuf> {
    let stem = path.file_stem()?;
    let dir = path.parent()?;
    let direct = path.with_extension("lrc");
    if direct.is_file() {
        return Some(direct);
    }
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.file_stem() == Some(stem)
                && p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("lrc"))
        })
}

fn read_text(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Lyrics stored in the file's tags (ID3 USLT, Vorbis LYRICS, MP4 ©lyr …).
pub fn embedded_lyrics(path: &Path) -> Option<String> {
    let file = lofty::read_from_path(path).ok()?;
    file.tags()
        .iter()
        // ID3 keeps lyrics in USLT ("unsynced"), but taggers often put LRC text there too.
        .find_map(|t| {
            t.get_string(ItemKey::Lyrics)
                .or_else(|| t.get_string(ItemKey::UnsyncLyrics))
                .map(str::to_string)
        })
        .filter(|s| !s.trim().is_empty())
}

/// One answer from the LRCLIB search API (only the fields we use).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibHit {
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

/// Asks LRCLIB for a track. Only artist and title are sent. Picks a hit about as long as
/// the file (within 5 s), preferring synced lyrics.
pub fn lrclib(f: &dyn Fetcher, artist: &str, title: &str, seconds: Option<f64>) -> Option<Lyrics> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return None;
    }
    let url = format!(
        "https://lrclib.net/api/search?artist_name={}&track_name={}",
        enc(artist.trim()),
        enc(title.trim())
    );
    let body = f.get(&url).ok()?;
    let hits: Vec<LrclibHit> = serde_json::from_slice(&body).ok()?;
    let fits = |h: &&LrclibHit| match (seconds, h.duration) {
        (Some(s), Some(d)) => (s - d).abs() <= 5.0,
        _ => true,
    };
    let has = |s: &Option<String>| s.as_deref().is_some_and(|t| !t.trim().is_empty());
    let hit = hits
        .iter()
        .filter(fits)
        .find(|h| has(&h.synced_lyrics))
        .or_else(|| hits.iter().filter(fits).find(|h| has(&h.plain_lyrics)))
        .or_else(|| hits.iter().filter(fits).find(|h| h.instrumental))?;
    if hit.instrumental && !has(&hit.synced_lyrics) && !has(&hit.plain_lyrics) {
        return Some(Lyrics {
            lines: Vec::new(),
            synced: false,
            source: LyricsSource::Lrclib,
            instrumental: true,
        });
    }
    hit.synced_lyrics
        .as_deref()
        .and_then(|t| from_text(t, LyricsSource::Lrclib))
        .or_else(|| {
            hit.plain_lyrics
                .as_deref()
                .and_then(|t| from_text(t, LyricsSource::Lrclib))
        })
}

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS lyrics_cache (
    track_id  INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    found     INTEGER NOT NULL,
    body      TEXT NOT NULL,
    fetched   INTEGER NOT NULL
)";

impl Library {
    fn ensure_lyrics(&self) -> Result<()> {
        self.conn().execute_batch(SCHEMA)?;
        Ok(())
    }

    /// The saved LRCLIB answer: `None` = never asked; `Some(None)` = asked, nothing found.
    fn cached_lrclib(&self, track_id: i64) -> Result<Option<Option<Lyrics>>> {
        self.ensure_lyrics()?;
        let row: Option<(bool, String)> = self
            .conn()
            .query_row(
                "SELECT found, body FROM lyrics_cache WHERE track_id = ?1",
                [track_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(row.map(|(found, body)| {
            if !found {
                None
            } else if body.is_empty() {
                Some(Lyrics {
                    lines: Vec::new(),
                    synced: false,
                    source: LyricsSource::Lrclib,
                    instrumental: true,
                })
            } else {
                from_text(&body, LyricsSource::Lrclib)
            }
        }))
    }

    fn save_lrclib(&self, track_id: i64, found: Option<&Lyrics>) -> Result<()> {
        self.ensure_lyrics()?;
        // Synced lines are stored back as LRC; plain ones as text.
        let body = found.map_or(String::new(), |l| {
            l.lines
                .iter()
                .map(|x| {
                    if l.synced {
                        format!(
                            "[{:02}:{:02}.{:02}]{}",
                            x.ms / 60_000,
                            (x.ms / 1000) % 60,
                            (x.ms % 1000) / 10,
                            x.text
                        )
                    } else {
                        x.text.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
        self.conn().execute(
            "INSERT OR REPLACE INTO lyrics_cache (track_id, found, body, fetched) VALUES (?1, ?2, ?3, ?4)",
            params![track_id, found.is_some(), body, now()],
        )?;
        Ok(())
    }

    /// Lyrics for a track. Synced lyrics win over plain ones: the `.lrc` file, then the
    /// file's tags, then LRCLIB — asked only when `internet` is given, once per track.
    pub fn lyrics(&self, track_id: i64, internet: Option<&dyn Fetcher>) -> Result<Option<Lyrics>> {
        let row = self.track(track_id)?;
        let mut plain: Option<Lyrics> = None;
        let mut consider = |l: Option<Lyrics>| -> Option<Lyrics> {
            match l {
                Some(l) if l.synced => Some(l),
                Some(l) => {
                    if plain.is_none() {
                        plain = Some(l);
                    }
                    None
                }
                None => None,
            }
        };
        if let Some(l) = consider(
            lrc_file(&row.path)
                .and_then(|p| read_text(&p))
                .and_then(|t| from_text(&t, LyricsSource::File)),
        ) {
            return Ok(Some(l));
        }
        if let Some(l) =
            consider(embedded_lyrics(&row.path).and_then(|t| from_text(&t, LyricsSource::Embedded)))
        {
            return Ok(Some(l));
        }
        let online = match self.cached_lrclib(track_id)? {
            Some(cached) => cached,
            None => match internet {
                Some(f) => {
                    let seconds = row.duration_ms.map(|ms| ms as f64 / 1000.0);
                    let found = lrclib(f, &row.artist, &row.title, seconds);
                    self.save_lrclib(track_id, found.as_ref())?;
                    found
                }
                None => None,
            },
        };
        if let Some(l) = online {
            if l.synced || l.instrumental || plain.is_none() {
                return Ok(Some(l));
            }
        }
        Ok(plain)
    }
}
