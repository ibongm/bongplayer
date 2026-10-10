//! `.m3u` / `.m3u8` playlist import.

use std::path::{Path, PathBuf};

/// Result of reading a playlist file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct M3u {
    /// Entries that exist on disk, in playlist order.
    pub found: Vec<PathBuf>,
    /// Entries that could not be found (shown to the user, not silently dropped).
    pub missing: Vec<String>,
    /// Web addresses (radio streams) listed in the file.
    pub urls: Vec<String>,
}

/// Decodes playlist bytes: UTF-8 (with or without BOM); otherwise Windows-1252, which is what
/// old `.m3u` files written by Windows players use.
fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1252(b)).collect(),
    }
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9F => HIGH[usize::from(b - 0x80)],
        _ => char::from(b),
    }
}

/// Parses playlist text. Relative paths are resolved against `base_dir`.
pub fn parse(text: &str, base_dir: &Path) -> M3u {
    let mut out = M3u::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let lower = line.to_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") {
            out.urls.push(line.to_string());
            continue;
        }
        let entry = line.strip_prefix("file:///").unwrap_or(line);
        let p = PathBuf::from(entry);
        let full = if p.is_absolute() { p } else { base_dir.join(p) };
        if full.is_file() {
            out.found.push(full);
        } else {
            out.missing.push(line.to_string());
        }
    }
    out
}

pub fn read(path: &Path) -> std::io::Result<M3u> {
    let bytes = std::fs::read(path)?;
    let base = path.parent().unwrap_or(Path::new("."));
    Ok(parse(&decode_text(&bytes), base))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_absolute_missing_and_urls() {
        let dir = tempfile::tempdir().expect("tmp");
        let sub = dir.path().join("Sub Folder");
        std::fs::create_dir(&sub).expect("mkdir");
        std::fs::write(sub.join("a.mp3"), b"x").expect("write");
        let abs = dir.path().join("b.flac");
        std::fs::write(&abs, b"x").expect("write");
        let text = format!(
            "#EXTM3U\n#EXTINF:123,Artist - A\nSub Folder/a.mp3\n{}\nnot-here.mp3\nhttp://radio.example/stream\n",
            abs.display()
        );
        let m = parse(&text, dir.path());
        assert_eq!(m.found, vec![sub.join("a.mp3"), abs]);
        assert_eq!(m.missing, vec!["not-here.mp3".to_string()]);
        assert_eq!(m.urls, vec!["http://radio.example/stream".to_string()]);
    }

    #[test]
    fn windows_1252_and_bom() {
        assert_eq!(decode_text(b"\xEF\xBB\xBFa.mp3"), "a.mp3");
        assert_eq!(decode_text(b"Caf\xe9.mp3"), "Café.mp3");
        assert_eq!(decode_text(b"\x93q\x94"), "“q”");
    }
}
