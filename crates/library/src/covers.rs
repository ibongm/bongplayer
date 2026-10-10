//! Cover pictures: embedded in the file, a picture in the track's folder (folder.jpg,
//! cover.jpg …), or one fetched by the optional internet lookup. Small JPEGs (thumbnail for
//! the table, large for the Info panel) are cached on disk so files are not re-read.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{imageops::FilterType, ImageFormat, ImageReader};
use lofty::picture::PictureType;
use lofty::prelude::*;
use serde::Serialize;

use crate::db::{Library, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverSize {
    /// 64 × 64 for the track table.
    Thumb,
    /// Up to 400 × 400 for the Info panel and decks.
    Large,
}

impl CoverSize {
    fn pixels(self) -> u32 {
        match self {
            Self::Thumb => 64,
            Self::Large => 400,
        }
    }
    fn tag(self) -> &'static str {
        match self {
            Self::Thumb => "thumb",
            Self::Large => "large",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverSource {
    Embedded,
    Folder,
    Internet,
}

/// Folder picture names tried in order (case-insensitive).
const FOLDER_NAMES: [&str; 6] = [
    "folder",
    "cover",
    "front",
    "albumart",
    "album",
    "albumartsmall",
];

/// The picture embedded in the file's tags (the front cover if marked).
pub fn embedded_picture(path: &Path) -> Option<Vec<u8>> {
    let file = lofty::read_from_path(path).ok()?;
    let mut best: Option<Vec<u8>> = None;
    for tag in file.tags() {
        for pic in tag.pictures() {
            if pic.pic_type() == PictureType::CoverFront {
                return Some(pic.data().to_vec());
            }
            if best.is_none() {
                best = Some(pic.data().to_vec());
            }
        }
    }
    best
}

/// A cover picture in the track's folder.
pub fn folder_picture(path: &Path) -> Option<PathBuf> {
    let dir = path.parent()?;
    let mut images: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                ["jpg", "jpeg", "png"]
                    .iter()
                    .any(|x| e.eq_ignore_ascii_case(x))
            })
        })
        .collect();
    images.sort();
    for name in FOLDER_NAMES {
        if let Some(p) = images.iter().find(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case(name))
        }) {
            return Some(p.clone());
        }
    }
    // A single picture in the folder is taken as the cover.
    (images.len() == 1).then(|| images.remove(0))
}

/// Scales an image down to fit `max` pixels and encodes it as JPEG.
pub fn resize_jpeg(bytes: &[u8], max: u32) -> Option<Vec<u8>> {
    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let img = if img.width() > max || img.height() > max {
        img.resize(max, max, FilterType::Triangle)
    } else {
        img
    };
    let mut out = Cursor::new(Vec::new());
    img.to_rgb8().write_to(&mut out, ImageFormat::Jpeg).ok()?;
    Some(out.into_inner())
}

impl Library {
    /// Where cover thumbnails are kept (set once at start-up).
    pub fn set_covers_dir(&mut self, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        self.covers_dir = Some(dir);
    }

    fn internet_cover_path(&self, track_id: i64) -> Option<PathBuf> {
        self.covers_dir
            .as_ref()
            .map(|d| d.join(format!("{track_id}-internet.jpg")))
    }

    /// Stores a cover found by the internet lookup.
    pub fn save_internet_cover(&self, track_id: i64, bytes: &[u8]) -> Result<bool> {
        let Some(path) = self.internet_cover_path(track_id) else {
            return Ok(false);
        };
        let Some(jpeg) = resize_jpeg(bytes, CoverSize::Large.pixels()) else {
            return Ok(false);
        };
        std::fs::write(&path, jpeg)
            .map_err(|e| crate::LibraryError::Invalid(format!("cannot save the cover: {e}")))?;
        self.conn()
            .execute("UPDATE tracks SET has_cover = 1 WHERE id = ?1", [track_id])?;
        Ok(true)
    }

    /// The cover of a track at `size`, from the cache or found and cached now. `None` when
    /// the track has no cover anywhere.
    pub fn cover(&self, track_id: i64, size: CoverSize) -> Result<Option<(Vec<u8>, CoverSource)>> {
        let row = self.track(track_id)?;
        let mtime: i64 = self.conn().query_row(
            "SELECT file_mtime FROM tracks WHERE id = ?1",
            [track_id],
            |r| r.get(0),
        )?;
        let cached = self
            .covers_dir
            .as_ref()
            .map(|d| d.join(format!("{track_id}-{mtime}-{}.jpg", size.tag())));
        let source_tag = self
            .covers_dir
            .as_ref()
            .map(|d| d.join(format!("{track_id}-{mtime}.source")));
        if let (Some(c), Some(st)) = (&cached, &source_tag) {
            if let (Ok(bytes), Ok(src)) = (std::fs::read(c), std::fs::read_to_string(st)) {
                let source = match src.trim() {
                    "embedded" => CoverSource::Embedded,
                    "folder" => CoverSource::Folder,
                    _ => CoverSource::Internet,
                };
                return Ok(Some((bytes, source)));
            }
        }
        let found: Option<(Vec<u8>, CoverSource)> = embedded_picture(&row.path)
            .map(|b| (b, CoverSource::Embedded))
            .or_else(|| {
                folder_picture(&row.path)
                    .and_then(|p| std::fs::read(p).ok())
                    .map(|b| (b, CoverSource::Folder))
            })
            .or_else(|| {
                self.internet_cover_path(track_id)
                    .and_then(|p| std::fs::read(p).ok())
                    .map(|b| (b, CoverSource::Internet))
            });
        let Some((bytes, source)) = found else {
            return Ok(None);
        };
        let Some(jpeg) = resize_jpeg(&bytes, size.pixels()) else {
            return Ok(None);
        };
        if let (Some(c), Some(st)) = (cached, source_tag) {
            let tag = match source {
                CoverSource::Embedded => "embedded",
                CoverSource::Folder => "folder",
                CoverSource::Internet => "internet",
            };
            // The cache is a convenience: failing to write it is not an error.
            let _ = std::fs::write(c, &jpeg);
            let _ = std::fs::write(st, tag);
        }
        Ok(Some((jpeg, source)))
    }
}
