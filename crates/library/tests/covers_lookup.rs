//! M7 acceptance (library): embedded art and folder.jpg shown with no internet; covers cached.
//! Internet lookup fills missing fields once per track — tested against responses recorded
//! from MusicBrainz and iTunes on 2026-10-10 (no network is used here).

use std::cell::RefCell;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{ImageFormat, RgbImage};
use library::covers::{CoverSize, CoverSource};
use library::lookup::{lookup, Fetcher};
use library::Library;
use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// A plain-colour JPEG (stands in for album art; no real covers are stored in the repo).
fn jpeg(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
    let img = RgbImage::from_pixel(w, h, image::Rgb(rgb));
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Jpeg).expect("encode");
    out.into_inner()
}

fn decoded_size(bytes: &[u8]) -> (u32, u32) {
    let img = image::load_from_memory(bytes).expect("decode");
    (img.width(), img.height())
}

fn library(dir: &Path) -> Library {
    let mut lib = Library::open(&dir.join("lib.db")).expect("db");
    lib.set_covers_dir(dir.join("covers"));
    lib
}

#[test]
fn embedded_art_is_found_without_internet_and_cached() {
    let dir = tempfile::tempdir().expect("tmp");
    let song = dir.path().join("01 - Artist - Song.mp3");
    std::fs::copy(fixture("song_128bpm_Am.mp3"), &song).expect("copy");
    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(
        Picture::unchecked(jpeg(600, 600, [200, 30, 30]))
            .pic_type(PictureType::CoverFront)
            .mime_type(MimeType::Jpeg)
            .build(),
    );
    tag.save_to_path(&song, WriteOptions::default())
        .expect("tag");

    let lib = library(dir.path());
    let (rows, _) = lib
        .tracks_for_paths(std::slice::from_ref(&song))
        .expect("scan");
    let id = rows[0].id;
    assert!(rows[0].has_cover);
    let (thumb, src) = lib
        .cover(id, CoverSize::Thumb)
        .expect("cover")
        .expect("found");
    assert_eq!(src, CoverSource::Embedded);
    assert_eq!(decoded_size(&thumb), (64, 64));
    let (large, _) = lib
        .cover(id, CoverSize::Large)
        .expect("cover")
        .expect("found");
    assert_eq!(decoded_size(&large), (400, 400));

    // Cached: the cover still comes back after the audio file is gone.
    std::fs::remove_file(&song).expect("rm");
    let (again, src) = lib
        .cover(id, CoverSize::Thumb)
        .expect("cover")
        .expect("cached");
    assert_eq!(again, thumb);
    assert_eq!(src, CoverSource::Embedded);
}

#[test]
fn folder_jpg_is_used_when_the_file_has_no_art() {
    let dir = tempfile::tempdir().expect("tmp");
    let album = dir.path().join("Album");
    std::fs::create_dir(&album).expect("mkdir");
    let song = album.join("02 - Artist - Other.mp3");
    std::fs::copy(fixture("song_82bpm_G.mp3"), &song).expect("copy");
    std::fs::write(album.join("Folder.JPG"), jpeg(300, 200, [20, 120, 220])).expect("folder.jpg");
    std::fs::write(album.join("back.jpg"), jpeg(10, 10, [0, 0, 0])).expect("other image");

    let lib = library(dir.path());
    let (rows, _) = lib.tracks_for_paths(&[song]).expect("scan");
    let (thumb, src) = lib
        .cover(rows[0].id, CoverSize::Thumb)
        .expect("cover")
        .expect("found");
    assert_eq!(src, CoverSource::Folder);
    assert_eq!(
        decoded_size(&thumb),
        (64, 43),
        "aspect kept, scaled to fit 64 px"
    );

    // A folder with no picture: no cover, and no error.
    let bare = dir.path().join("Bare");
    std::fs::create_dir(&bare).expect("mkdir");
    let s2 = bare.join("x.mp3");
    std::fs::copy(fixture("song_82bpm_G.mp3"), &s2).expect("copy");
    let (rows, _) = lib.tracks_for_paths(&[s2]).expect("scan");
    assert!(lib
        .cover(rows[0].id, CoverSize::Thumb)
        .expect("cover")
        .is_none());
}

/// Answers from recorded files; counts requests.
struct Recorded {
    calls: RefCell<Vec<String>>,
}

impl Recorded {
    fn new() -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
        }
    }
}

impl Fetcher for Recorded {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        self.calls.borrow_mut().push(url.to_string());
        let file =
            |n: &str| std::fs::read(fixture(&format!("lookup/{n}"))).map_err(|e| e.to_string());
        if url.contains("musicbrainz.org/ws/2/recording") {
            if url.contains("Beatles") {
                file("musicbrainz_come_together.json")
            } else {
                file("musicbrainz_recording.json")
            }
        } else if url.contains("musicbrainz.org/ws/2/release-group/") {
            file("musicbrainz_release_group.json")
        } else if url.contains("itunes.apple.com") {
            file("itunes_search.json")
        } else if url.contains("deezer.com") {
            file("deezer_search.json")
        } else if url.contains("coverartarchive.org")
            || url.contains("mzstatic.com")
            || url.contains("dzcdn.net")
        {
            Ok(jpeg(500, 500, [240, 200, 0]))
        } else {
            Err(format!("unexpected URL {url}"))
        }
    }
}

#[test]
fn musicbrainz_finds_the_studio_album_and_original_year() {
    let f = Recorded::new();
    let r = lookup(&f, "The Beatles", "Come Together", Some(259.0)).expect("found");
    assert_eq!(r.source.as_deref(), Some("MusicBrainz"));
    assert_eq!(r.album.as_deref(), Some("Abbey Road"));
    assert_eq!(r.year, Some(1969), "original year, not the 2019 remaster");
    assert_eq!(r.genre.as_deref(), Some("Rock"));
    assert!(r
        .cover_url
        .is_some_and(|u| u.contains("coverartarchive.org/release-group/9162580e")));
}

#[test]
fn live_and_karaoke_versions_are_rejected_and_itunes_answers() {
    let f = Recorded::new();
    let r = lookup(&f, "Nirvana", "Smells Like Teen Spirit", Some(301.0)).expect("found");
    assert_eq!(r.source.as_deref(), Some("iTunes"));
    assert_eq!(r.album.as_deref(), Some("Nevermind"));
    assert_eq!(r.year, Some(1991));
    assert_eq!(r.genre.as_deref(), Some("Rock"));
    assert!(r.cover_url.is_some_and(|u| u.contains("600x600")));
    assert!(
        lookup(&f, "", "x", None).is_none(),
        "nothing is sent without artist and title"
    );
}

#[test]
fn lookup_fills_only_missing_fields_and_runs_once_per_track() {
    let dir = tempfile::tempdir().expect("tmp");
    let song = dir.path().join("Nirvana - Smells Like Teen Spirit.mp3");
    std::fs::copy(fixture("song_168bpm_E.mp3"), &song).expect("copy");
    let lib = library(dir.path());
    let (rows, _) = lib.tracks_for_paths(&[song]).expect("scan");
    let id = rows[0].id;
    assert_eq!((rows[0].album.as_str(), rows[0].year), ("", None));

    let f = Recorded::new();
    let out = lib.lookup_track(id, &f).expect("lookup");
    assert!(out.fetched);
    assert_eq!(out.source.as_deref(), Some("iTunes"));
    assert_eq!(out.filled, vec!["album", "year", "genre"]);
    assert!(out.cover);
    let row = lib.track(id).expect("row");
    assert_eq!(row.album, "Nevermind");
    assert_eq!(row.year, Some(1991));
    assert_eq!(row.genre, "Rock");
    assert!(row.has_cover);
    let (_, src) = lib
        .cover(id, CoverSize::Large)
        .expect("cover")
        .expect("found");
    assert_eq!(src, CoverSource::Internet);

    // Once per track: a second lookup sends nothing.
    let n = f.calls.borrow().len();
    let again = lib.lookup_track(id, &f).expect("lookup");
    assert!(!again.fetched);
    assert_eq!(f.calls.borrow().len(), n);
    // Only artist and title went out (no file names, no paths).
    for url in f.calls.borrow().iter() {
        assert!(!url.contains(".mp3") && !url.contains("Users"), "{url}");
    }
}
