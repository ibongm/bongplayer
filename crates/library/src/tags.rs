//! Reading tags (title, artist, …) and basic properties from audio files.

use std::path::Path;

use lofty::prelude::*;

/// What the file's tags say. Every field is optional: many files are badly tagged.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Tags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub remix: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub duration_ms: Option<u64>,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub has_cover: bool,
}

/// File extensions treated as audio.
pub const AUDIO_EXTENSIONS: [&str; 9] = [
    "mp3", "flac", "wav", "m4a", "mp4", "aac", "ogg", "oga", "aif",
];

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO_EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

fn clean(s: &str) -> Option<String> {
    let t = s.trim().trim_matches('\0').trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Splits "Song (Extended Mix)" into ("Song", Some("Extended Mix")). Only brackets that look
/// like a version (mix, remix, edit, version, dub, rework, bootleg, vip) count.
pub fn split_remix(title: &str) -> (String, Option<String>) {
    const WORDS: [&str; 8] = [
        "mix", "remix", "edit", "version", "dub", "rework", "bootleg", "vip",
    ];
    let t = title.trim();
    for (open, close) in [('(', ')'), ('[', ']')] {
        if t.ends_with(close) {
            if let Some(start) = t.rfind(open) {
                let inner = &t[start + 1..t.len() - 1];
                let lower = inner.to_lowercase();
                if WORDS
                    .iter()
                    .any(|w| lower.split_whitespace().any(|x| x == *w))
                {
                    let head = t[..start].trim_end();
                    if !head.is_empty() {
                        return (head.to_string(), clean(inner));
                    }
                }
            }
        }
    }
    (t.to_string(), None)
}

/// Guesses "Artist - Title" from a file name when tags are missing.
pub fn guess_from_file_name(path: &Path) -> (Option<String>, Option<String>) {
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return (None, None);
    };
    // Strip a leading track number like "01 ", "01. ", "01 - ".
    let s = stem.trim_start_matches(|c: char| c.is_ascii_digit());
    let s = if s.len() < stem.len() {
        s.trim_start_matches(['.', '-', ' ', '_'])
    } else {
        stem
    };
    match s.split_once(" - ") {
        Some((a, t)) => (clean(a), clean(t)),
        None => (None, clean(s)),
    }
}

/// Reads tags and duration. Never panics; unreadable tags give an empty result.
pub fn read_tags(path: &Path) -> Tags {
    let mut tags = Tags::default();
    if let Ok(file) = lofty::read_from_path(path) {
        let d = file.properties().duration().as_millis();
        tags.duration_ms = u64::try_from(d).ok().filter(|&d| d > 0);
        if let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) {
            let get = |k: ItemKey| tag.get_string(k).and_then(clean);
            tags.title = get(ItemKey::TrackTitle);
            tags.artist = get(ItemKey::TrackArtist).or_else(|| get(ItemKey::AlbumArtist));
            tags.album = get(ItemKey::AlbumTitle);
            tags.genre = get(ItemKey::Genre);
            tags.year = get(ItemKey::Year)
                .or_else(|| get(ItemKey::RecordingDate))
                .and_then(|s| s.get(..4).and_then(|y| y.parse().ok()));
            tags.bpm = get(ItemKey::Bpm)
                .or_else(|| get(ItemKey::IntegerBpm))
                .and_then(|s| s.replace(',', ".").parse::<f64>().ok())
                .filter(|b| (20.0..400.0).contains(b));
            tags.key = get(ItemKey::InitialKey);
            tags.has_cover = !tag.pictures().is_empty();
        }
    }
    if tags.title.is_none() {
        let (artist, title) = guess_from_file_name(path);
        tags.title = title;
        if tags.artist.is_none() {
            tags.artist = artist;
        }
    }
    if let Some(title) = tags.title.take() {
        let (t, remix) = split_remix(&title);
        tags.title = Some(t);
        tags.remix = remix;
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remix_is_split_from_the_title() {
        assert_eq!(
            split_remix("Strobe (Extended Mix)"),
            ("Strobe".into(), Some("Extended Mix".into()))
        );
        assert_eq!(
            split_remix("Song [Radio Edit]"),
            ("Song".into(), Some("Radio Edit".into()))
        );
        assert_eq!(split_remix("Song (Live)"), ("Song (Live)".into(), None));
        assert_eq!(split_remix("(Remix)"), ("(Remix)".into(), None));
    }

    #[test]
    fn file_names_give_artist_and_title() {
        let (a, t) = guess_from_file_name(Path::new(r"C:\m\01 - Nirvana - Lithium.mp3"));
        assert_eq!(a.as_deref(), Some("Nirvana"));
        assert_eq!(t.as_deref(), Some("Lithium"));
        let (a, t) = guess_from_file_name(Path::new("Intro.flac"));
        assert_eq!((a, t.as_deref()), (None, Some("Intro")));
    }

    #[test]
    fn audio_extensions() {
        assert!(is_audio(Path::new("a.MP3")));
        assert!(is_audio(Path::new("a.m4a")));
        assert!(!is_audio(Path::new("a.jpg")));
        assert!(!is_audio(Path::new("mp3")));
    }
}
