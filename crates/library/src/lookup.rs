//! Optional internet lookup (OFF by default; the app only calls this when the user switched
//! it on). Fills missing album / year / genre and finds a cover, once per track:
//!
//! 1. **MusicBrainz** recording search (artist + title). Only a clean studio release counts:
//!    official, an album, no "live / karaoke / demo" note, not a compilation or live album,
//!    and about as long as the file. The release group then gives the original year and the
//!    genres; **Cover Art Archive** gives its front cover.
//! 2. Otherwise **iTunes** search (album, year, genre, cover), then **Deezer** (album, cover).
//!
//! Only artist and title are sent. MusicBrainz is asked at most once per second.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::db::{Library, Result};

/// Something that can fetch a URL (the real network, or recorded answers in tests).
pub trait Fetcher {
    /// Returns the body, or an error message.
    fn get(&self, url: &str) -> std::result::Result<Vec<u8>, String>;
}

const USER_AGENT: &str = concat!(
    "BongPlayer/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/ibongm/bongplayer)"
);

/// The real network (HTTPS with the Windows certificate store).
pub struct NetFetcher {
    agent: ureq::Agent,
}

impl Default for NetFetcher {
    fn default() -> Self {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .tls_config(
                TlsConfig::builder()
                    .provider(TlsProvider::Rustls)
                    .root_certs(RootCerts::PlatformVerifier)
                    .build(),
            )
            .timeout_global(Some(Duration::from_secs(15)))
            .user_agent(USER_AGENT)
            .build()
            .into();
        Self { agent }
    }
}

impl Fetcher for NetFetcher {
    fn get(&self, url: &str) -> std::result::Result<Vec<u8>, String> {
        let resp = self.agent.get(url).call().map_err(|e| e.to_string())?;
        resp.into_body()
            .with_config()
            .limit(8 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| e.to_string())
    }
}

static LAST_MB: Mutex<Option<Instant>> = Mutex::new(None);

/// MusicBrainz allows one request per second per client.
fn mb_pace() {
    let mut last = LAST_MB.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(t) = *last {
        let since = t.elapsed();
        if since < Duration::from_millis(1100) {
            std::thread::sleep(Duration::from_millis(1100) - since);
        }
    }
    *last = Some(Instant::now());
}

fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(b))
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Lowercase, without bracketed parts like "(2019 Mix)" and punctuation.
fn norm(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            _ if depth > 0 => {}
            c if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupResult {
    pub album: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub cover_url: Option<String>,
    /// Which service answered ("MusicBrainz", "iTunes", "Deezer").
    pub source: Option<String>,
}

fn year_of(date: &str) -> Option<i32> {
    date.get(..4)?.parse().ok()
}

fn title_case(s: &str) -> String {
    s.split(' ')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

const BAD_NOTES: [&str; 8] = [
    "live",
    "karaoke",
    "demo",
    "instrumental",
    "acoustic",
    "remix",
    "rehearsal",
    "cover",
];

/// Picks the release group of a clean studio album release from a MusicBrainz search.
fn pick_release_group(
    json: &Value,
    artist: &str,
    title: &str,
    seconds: Option<f64>,
) -> Option<String> {
    let (want_artist, want_title) = (norm(artist), norm(title));
    let mut best: Option<(String, String)> = None; // (date, release-group id)
    for rec in json.get("recordings")?.as_array()? {
        if rec.get("score").and_then(Value::as_i64).unwrap_or(0) < 80 {
            continue;
        }
        if norm(rec.get("title")?.as_str()?) != want_title {
            continue;
        }
        let note = rec
            .get("disambiguation")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();
        if BAD_NOTES.iter().any(|b| note.contains(b)) {
            continue;
        }
        let artists: Vec<String> = rec
            .get("artist-credit")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|c| c.get("name")?.as_str().map(norm))
                    .collect()
            })
            .unwrap_or_default();
        if !artists.contains(&want_artist) {
            continue;
        }
        // The length must match the file (rules out medleys, edits and live takes).
        match (seconds, rec.get("length").and_then(Value::as_f64)) {
            (Some(s), Some(ms)) => {
                let diff = (ms / 1000.0 - s).abs();
                if diff > (s * 0.06).max(6.0) {
                    continue;
                }
            }
            (Some(_), None) => continue,
            _ => {}
        }
        for rel in rec
            .get("releases")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if rel.get("status").and_then(Value::as_str) != Some("Official") {
                continue;
            }
            let rg = rel.get("release-group")?;
            if rg.get("primary-type").and_then(Value::as_str) != Some("Album") {
                continue;
            }
            if rg
                .get("secondary-types")
                .and_then(Value::as_array)
                .is_some_and(|s| !s.is_empty())
            {
                continue;
            }
            let date = rel
                .get("date")
                .and_then(Value::as_str)
                .unwrap_or("9999")
                .to_string();
            let id = rg.get("id")?.as_str()?.to_string();
            if best.as_ref().is_none_or(|(d, _)| date < *d) {
                best = Some((date, id));
            }
        }
    }
    best.map(|(_, id)| id)
}

fn musicbrainz(
    f: &dyn Fetcher,
    artist: &str,
    title: &str,
    seconds: Option<f64>,
) -> Option<LookupResult> {
    let q = format!(
        "artist:\"{artist}\" AND recording:\"{title}\" AND status:official AND primarytype:album"
    );
    mb_pace();
    let url = format!(
        "https://musicbrainz.org/ws/2/recording/?query={}&fmt=json&limit=25",
        enc(&q)
    );
    let json: Value = serde_json::from_slice(&f.get(&url).ok()?).ok()?;
    let rg = pick_release_group(&json, artist, title, seconds)?;
    mb_pace();
    let url = format!("https://musicbrainz.org/ws/2/release-group/{rg}?inc=genres&fmt=json");
    let g: Value = serde_json::from_slice(&f.get(&url).ok()?).ok()?;
    let genre = g
        .get("genres")
        .and_then(Value::as_array)
        .and_then(|gs| {
            gs.iter()
                .max_by_key(|x| x.get("count").and_then(Value::as_i64).unwrap_or(0))
        })
        .and_then(|x| x.get("name")?.as_str().map(title_case));
    Some(LookupResult {
        album: g.get("title").and_then(Value::as_str).map(str::to_string),
        year: g
            .get("first-release-date")
            .and_then(Value::as_str)
            .and_then(year_of),
        genre,
        cover_url: Some(format!(
            "https://coverartarchive.org/release-group/{rg}/front-500"
        )),
        source: Some("MusicBrainz".into()),
    })
}

fn itunes(f: &dyn Fetcher, artist: &str, title: &str) -> Option<LookupResult> {
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=5",
        enc(&format!("{artist} {title}"))
    );
    let json: Value = serde_json::from_slice(&f.get(&url).ok()?).ok()?;
    let hit = json.get("results")?.as_array()?.iter().find(|r| {
        r.get("artistName").and_then(Value::as_str).map(norm) == Some(norm(artist))
            && r.get("trackName").and_then(Value::as_str).map(norm) == Some(norm(title))
    })?;
    Some(LookupResult {
        album: hit
            .get("collectionName")
            .and_then(Value::as_str)
            .map(str::to_string),
        year: hit
            .get("releaseDate")
            .and_then(Value::as_str)
            .and_then(year_of),
        genre: hit
            .get("primaryGenreName")
            .and_then(Value::as_str)
            .map(str::to_string),
        cover_url: hit
            .get("artworkUrl100")
            .and_then(Value::as_str)
            .map(|u| u.replace("100x100bb", "600x600bb")),
        source: Some("iTunes".into()),
    })
}

fn deezer(f: &dyn Fetcher, artist: &str, title: &str) -> Option<LookupResult> {
    let url = format!(
        "https://api.deezer.com/search?q={}&limit=5",
        enc(&format!("{artist} {title}"))
    );
    let json: Value = serde_json::from_slice(&f.get(&url).ok()?).ok()?;
    let hit = json.get("data")?.as_array()?.iter().find(|r| {
        r.get("artist")
            .and_then(|a| a.get("name"))
            .and_then(Value::as_str)
            .map(norm)
            == Some(norm(artist))
            && r.get("title").and_then(Value::as_str).map(norm) == Some(norm(title))
    })?;
    let album = hit.get("album")?;
    Some(LookupResult {
        album: album
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string),
        year: None,
        genre: None,
        cover_url: album
            .get("cover_big")
            .and_then(Value::as_str)
            .map(str::to_string),
        source: Some("Deezer".into()),
    })
}

/// Asks the services in order; None when nobody knows the track.
pub fn lookup(
    f: &dyn Fetcher,
    artist: &str,
    title: &str,
    seconds: Option<f64>,
) -> Option<LookupResult> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return None;
    }
    musicbrainz(f, artist, title, seconds)
        .or_else(|| itunes(f, artist, title))
        .or_else(|| deezer(f, artist, title))
}

/// What a lookup changed for one track.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupOutcome {
    /// False when the track had been looked up before (nothing was fetched).
    pub fetched: bool,
    pub filled: Vec<String>,
    pub cover: bool,
    pub source: Option<String>,
}

impl Library {
    /// Looks a track up once: fills only empty album / year / genre, and stores a cover if
    /// the track has none. Later calls do nothing (no network).
    pub fn lookup_track(&self, track_id: i64, f: &dyn Fetcher) -> Result<LookupOutcome> {
        let done: i64 = self.conn().query_row(
            "SELECT lookup_done FROM tracks WHERE id = ?1",
            [track_id],
            |r| r.get(0),
        )?;
        if done != 0 {
            return Ok(LookupOutcome::default());
        }
        let row = self.track(track_id)?;
        let mut out = LookupOutcome {
            fetched: true,
            ..LookupOutcome::default()
        };
        let seconds = row.duration_ms.map(|ms| ms as f64 / 1000.0);
        if let Some(r) = lookup(f, &row.artist, &row.title, seconds) {
            out.source.clone_from(&r.source);
            if row.album.is_empty() {
                if let Some(a) = &r.album {
                    self.conn().execute(
                        "UPDATE tracks SET album = ?2 WHERE id = ?1",
                        rusqlite::params![track_id, a],
                    )?;
                    out.filled.push("album".into());
                }
            }
            if row.year.is_none() {
                if let Some(y) = r.year {
                    self.conn().execute(
                        "UPDATE tracks SET year = ?2 WHERE id = ?1",
                        rusqlite::params![track_id, y],
                    )?;
                    out.filled.push("year".into());
                }
            }
            if row.genre.is_empty() {
                if let Some(g) = &r.genre {
                    self.conn().execute(
                        "UPDATE tracks SET genre = ?2 WHERE id = ?1",
                        rusqlite::params![track_id, g],
                    )?;
                    out.filled.push("genre".into());
                }
            }
            let has_local = self
                .cover(track_id, crate::covers::CoverSize::Thumb)?
                .is_some();
            if !has_local {
                if let Some(url) = &r.cover_url {
                    if let Ok(bytes) = f.get(url) {
                        out.cover = self.save_internet_cover(track_id, &bytes)?;
                    }
                }
            }
        }
        self.conn().execute(
            "UPDATE tracks SET lookup_done = 1 WHERE id = ?1",
            [track_id],
        )?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalising_titles() {
        assert_eq!(norm("Come Together (2019 Mix)"), "come together");
        assert_eq!(norm("Smells Like Teen Spirit"), "smells like teen spirit");
        assert_eq!(norm("AC/DC"), "ac dc");
        assert_eq!(enc("a b\"c"), "a%20b%22c");
    }
}
