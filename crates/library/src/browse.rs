//! Browsing drives and folders, one level at a time (never a full disk scan).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::tags::is_audio;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DriveKind {
    Fixed,
    Removable,
    Network,
    Optical,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub path: PathBuf,
    pub label: String,
    pub kind: DriveKind,
}

/// Drives present right now (C:\, USB sticks, network drives, …).
#[cfg(windows)]
pub fn drives() -> Vec<Drive> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    // DRIVE_* constants from the Windows API.
    const REMOVABLE: u32 = 2;
    const FIXED: u32 = 3;
    const REMOTE: u32 = 4;
    const CDROM: u32 = 5;
    // SAFETY: no arguments; returns a bitmask of present drive letters.
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| {
            let letter = char::from(b'A' + i);
            let root = format!("{letter}:\\");
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
            let kind = match unsafe { GetDriveTypeW(wide.as_ptr()) } {
                FIXED => DriveKind::Fixed,
                REMOVABLE => DriveKind::Removable,
                REMOTE => DriveKind::Network,
                CDROM => DriveKind::Optical,
                _ => DriveKind::Other,
            };
            Drive {
                path: PathBuf::from(&root),
                label: format!("{letter}:"),
                kind,
            }
        })
        .collect()
}

/// Other systems (development only): the filesystem root.
#[cfg(not(windows))]
pub fn drives() -> Vec<Drive> {
    vec![Drive {
        path: PathBuf::from("/"),
        label: "/".into(),
        kind: DriveKind::Fixed,
    }]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub path: PathBuf,
    pub name: String,
}

/// One folder's direct contents: subfolders and audio files, sorted by name.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub folders: Vec<FolderEntry>,
    pub audio_files: Vec<PathBuf>,
    /// `.m3u` / `.m3u8` playlists found here.
    pub playlists: Vec<PathBuf>,
}

fn sort_key(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Lists `dir` without descending into subfolders. Hidden/system entries the OS refuses to
/// read are skipped, not reported as errors.
pub fn list_dir(dir: &Path) -> std::io::Result<DirListing> {
    let mut out = DirListing::default();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('$') || name.eq_ignore_ascii_case("System Volume Information") {
            continue;
        }
        if ft.is_dir() {
            out.folders.push(FolderEntry { path, name });
        } else if is_audio(&path) {
            out.audio_files.push(path);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("m3u") || e.eq_ignore_ascii_case("m3u8"))
        {
            out.playlists.push(path);
        }
    }
    out.folders.sort_by_key(|f| f.name.to_lowercase());
    out.audio_files.sort_by_key(|p| sort_key(p));
    out.playlists.sort_by_key(|p| sort_key(p));
    Ok(out)
}

/// All audio files under `dir`, recursively (for "add folder to Automix / crate").
/// Stops after `limit` files.
pub fn audio_files_recursive(dir: &Path, limit: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(listing) = list_dir(&d) else { continue };
        out.extend(listing.audio_files);
        if out.len() >= limit {
            out.truncate(limit);
            break;
        }
        // Reverse so folders are visited in name order.
        stack.extend(listing.folders.into_iter().rev().map(|f| f.path));
    }
    out
}

/// Standard places offered in the explorer: Music, Downloads, user home.
pub fn special_folders() -> Vec<FolderEntry> {
    let Some(home) = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
    else {
        return Vec::new();
    };
    let mut v = Vec::new();
    for (name, sub) in [
        ("Music", Some("Music")),
        ("Downloads", Some("Downloads")),
        ("Home", None),
    ] {
        let path = match sub {
            Some(s) => home.join(s),
            None => home.clone(),
        };
        if path.is_dir() {
            v.push(FolderEntry {
                path,
                name: name.to_string(),
            });
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_folders_audio_and_playlists_sorted() {
        let dir = tempfile::tempdir().expect("tmp");
        std::fs::create_dir(dir.path().join("b-sub")).expect("mkdir");
        std::fs::create_dir(dir.path().join("A-sub")).expect("mkdir");
        for f in ["z.mp3", "a.FLAC", "notes.txt", "set.m3u8", "cover.jpg"] {
            std::fs::write(dir.path().join(f), b"x").expect("write");
        }
        let l = list_dir(dir.path()).expect("list");
        let folders: Vec<_> = l.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(folders, ["A-sub", "b-sub"]);
        let files: Vec<_> = l
            .audio_files
            .iter()
            .map(|p| {
                p.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(files, ["a.FLAC", "z.mp3"]);
        assert_eq!(l.playlists.len(), 1);
    }

    #[test]
    fn recursive_listing_respects_the_limit() {
        let dir = tempfile::tempdir().expect("tmp");
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).expect("mkdir");
        for i in 0..5 {
            std::fs::write(dir.path().join(format!("{i}.mp3")), b"x").expect("write");
            std::fs::write(sub.join(format!("{i}.mp3")), b"x").expect("write");
        }
        assert_eq!(audio_files_recursive(dir.path(), 100).len(), 10);
        assert_eq!(audio_files_recursive(dir.path(), 7).len(), 7);
    }

    #[test]
    fn drives_are_listed() {
        assert!(!drives().is_empty());
    }
}
