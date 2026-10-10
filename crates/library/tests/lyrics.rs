//! M8 acceptance (library): LRC parser (timestamps, several per line, offsets); lyrics from a
//! local .lrc file, from the file's tags, and from LRCLIB only when the internet is switched
//! on (recorded-shape answer with invented words; no network is used here).

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use library::lookup::Fetcher;
use library::lyrics::{parse_lrc, LyricLine, LyricsSource};
use library::Library;
use lofty::config::WriteOptions;
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn line(ms: i64, text: &str) -> LyricLine {
    LyricLine {
        ms,
        text: text.into(),
    }
}

#[test]
fn lrc_parser_reads_timestamps_in_every_common_form() {
    let text = "\u{feff}[ar:Someone]\n[ti:Something]\n[length: 03:20]\n\
                [00:01]one\n[00:02.5]two\n[00:03.25]three\n[00:04.125]four\n[00:05:50]five\n\
                [1:06.00]six\n[100:00.00]late\nno time here\n[00:07.00]";
    let lines = parse_lrc(text).expect("parsed");
    assert_eq!(
        lines,
        vec![
            line(1000, "one"),
            line(2500, "two"),
            line(3250, "three"),
            line(4125, "four"),
            line(5500, "five"),
            line(7000, ""),
            line(66_000, "six"),
            line(6_000_000, "late"),
        ]
    );
    assert!(parse_lrc("just words\nno times").is_none());
    assert!(parse_lrc("").is_none());
}

#[test]
fn lrc_parser_handles_several_times_per_line_and_word_timings() {
    let lines = parse_lrc(
        "[00:10.00][00:30.00]Chorus line\n[00:20.00]Verse\n[00:40.00]<00:40.00>Word <00:40.50>by <00:41.00>word",
    )
    .expect("parsed");
    assert_eq!(
        lines,
        vec![
            line(10_000, "Chorus line"),
            line(20_000, "Verse"),
            line(30_000, "Chorus line"),
            line(40_000, "Word by word"),
        ]
    );
}

#[test]
fn lrc_offset_moves_every_line() {
    // Positive offset = lyrics come sooner; negative = later; never before 0.
    let sooner = parse_lrc("[offset:+500]\n[00:10.00]a\n[00:00.20]b").expect("parsed");
    assert_eq!(sooner, vec![line(0, "b"), line(9500, "a")]);
    let later = parse_lrc("[00:10.00]a\n[offset:-250]").expect("parsed");
    assert_eq!(later, vec![line(10_250, "a")]);
}

/// Answers LRCLIB from the recorded-shape file; counts requests.
struct Recorded {
    calls: RefCell<Vec<String>>,
}

impl Fetcher for Recorded {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        self.calls.borrow_mut().push(url.to_string());
        if url.starts_with("https://lrclib.net/api/search?") {
            if url.contains("Test%20Artist") {
                std::fs::read(fixture("lyrics/lrclib_search.json")).map_err(|e| e.to_string())
            } else {
                Ok(b"[]".to_vec())
            }
        } else {
            Err(format!("unexpected URL {url}"))
        }
    }
}

fn song(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    std::fs::copy(fixture("song_128bpm_Am.mp3"), &p).expect("copy");
    p
}

#[test]
fn local_lrc_file_and_embedded_lyrics_are_found_without_internet() {
    let dir = tempfile::tempdir().expect("tmp");
    let lib = Library::open(&dir.path().join("lib.db")).expect("db");

    // 1. A .LRC file beside the song (any letter case).
    let a = song(dir.path(), "Test Artist - Test Song.mp3");
    std::fs::write(
        dir.path().join("Test Artist - Test Song.LRC"),
        "[00:01.00]From the file\n",
    )
    .expect("lrc");
    // 2. Synced (LRC) lyrics in the tags (ID3 USLT, where taggers usually put them).
    let b = song(dir.path(), "b.mp3");
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::UnsyncLyrics, "[00:03.00]From the tags".into());
    tag.save_to_path(&b, WriteOptions::default()).expect("tag");
    // 3. Plain lyrics in the tags.
    let c = song(dir.path(), "c.mp3");
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(
        ItemKey::UnsyncLyrics,
        "\nPlain first line\nPlain second line".into(),
    );
    tag.save_to_path(&c, WriteOptions::default()).expect("tag");
    // 4. Nothing at all.
    let d = song(dir.path(), "d.mp3");

    let (rows, _) = lib.tracks_for_paths(&[a, b, c, d]).expect("scan");
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();

    let l = lib.lyrics(ids[0], None).expect("ok").expect("found");
    assert_eq!((l.source, l.synced), (LyricsSource::File, true));
    assert_eq!(l.lines, vec![line(1000, "From the file")]);

    let l = lib.lyrics(ids[1], None).expect("ok").expect("found");
    assert_eq!((l.source, l.synced), (LyricsSource::Embedded, true));
    assert_eq!(l.lines, vec![line(3000, "From the tags")]);

    let l = lib.lyrics(ids[2], None).expect("ok").expect("found");
    assert_eq!((l.source, l.synced), (LyricsSource::Embedded, false));
    assert_eq!(
        l.lines.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(),
        vec!["Plain first line", "Plain second line"]
    );

    assert!(lib.lyrics(ids[3], None).expect("ok").is_none());
}

#[test]
fn lrclib_is_asked_only_when_switched_on_and_only_once() {
    let dir = tempfile::tempdir().expect("tmp");
    let lib = Library::open(&dir.path().join("lib.db")).expect("db");
    let a = song(dir.path(), "Test Artist - Test Song.mp3");
    let none = song(dir.path(), "Nobody - Unknown.mp3");
    let (rows, _) = lib.tracks_for_paths(&[a, none]).expect("scan");
    let (id, unknown) = (rows[0].id, rows[1].id);
    let f = Recorded {
        calls: RefCell::new(Vec::new()),
    };

    // Off: nothing found, nothing sent.
    assert!(lib.lyrics(id, None).expect("ok").is_none());
    assert!(f.calls.borrow().is_empty());

    // On: the hit about as long as the file (70 s) wins over the live version (312 s).
    let l = lib.lyrics(id, Some(&f)).expect("ok").expect("found");
    assert_eq!(
        (l.source, l.synced, l.instrumental),
        (LyricsSource::Lrclib, true, false)
    );
    assert_eq!(
        l.lines,
        vec![
            line(2000, "Invented words for a test"),
            line(6500, "Nothing here is a real song"),
            line(12_250, "The end"),
            line(15_000, ""),
        ]
    );
    assert_eq!(f.calls.borrow().len(), 1);

    // Kept: asking again (even with the internet off) sends nothing and gives the same lines.
    assert_eq!(lib.lyrics(id, Some(&f)).expect("ok"), Some(l.clone()));
    assert_eq!(lib.lyrics(id, None).expect("ok"), Some(l));
    assert_eq!(f.calls.borrow().len(), 1);

    // "Not found" is kept too.
    assert!(lib.lyrics(unknown, Some(&f)).expect("ok").is_none());
    assert!(lib.lyrics(unknown, Some(&f)).expect("ok").is_none());
    assert_eq!(f.calls.borrow().len(), 2);

    // Only artist and title went out.
    for url in f.calls.borrow().iter() {
        assert!(
            !url.contains(".mp3") && !url.contains("Temp") && !url.contains("tmp"),
            "{url}"
        );
    }
}
