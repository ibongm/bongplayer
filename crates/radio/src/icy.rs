//! ICY metadata: SHOUTcast / Icecast servers insert a small block with the current song title
//! every `metaint` bytes of audio. This reader removes those blocks from the audio and reports
//! the titles.

use std::io::Read;

pub type TitleSink = Box<dyn Fn(String) + Send>;

pub struct IcyReader {
    inner: Box<dyn Read + Send>,
    metaint: Option<usize>,
    /// Audio bytes left before the next metadata block.
    until_meta: usize,
    on_title: TitleSink,
    last: String,
}

impl IcyReader {
    pub fn new(inner: Box<dyn Read + Send>, metaint: Option<usize>, on_title: TitleSink) -> Self {
        let metaint = metaint.filter(|&m| m > 0);
        Self {
            inner,
            until_meta: metaint.unwrap_or(usize::MAX),
            metaint,
            on_title,
            last: String::new(),
        }
    }

    fn read_meta(&mut self) -> std::io::Result<()> {
        let mut len = [0u8; 1];
        self.inner.read_exact(&mut len)?;
        let n = usize::from(len[0]) * 16;
        if n > 0 {
            let mut block = vec![0u8; n];
            self.inner.read_exact(&mut block)?;
            if let Some(title) = parse_title(&block) {
                if title != self.last {
                    self.last.clone_from(&title);
                    (self.on_title)(title);
                }
            }
        }
        Ok(())
    }
}

/// Extracts `StreamTitle='…';` from a metadata block.
pub fn parse_title(block: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(block);
    let text = text.trim_end_matches('\0');
    let start = text.find("StreamTitle='")? + "StreamTitle='".len();
    let rest = &text[start..];
    let end = rest.find("';").unwrap_or(rest.len());
    let title = rest[..end].trim();
    (!title.is_empty()).then(|| title.to_string())
}

impl Read for IcyReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let Some(metaint) = self.metaint else {
            return self.inner.read(buf);
        };
        if self.until_meta == 0 {
            self.read_meta()?;
            self.until_meta = metaint;
        }
        let want = buf.len().min(self.until_meta);
        let n = self.inner.read(&mut buf[..want])?;
        self.until_meta -= n;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn meta(title: &str) -> Vec<u8> {
        let text = format!("StreamTitle='{title}';");
        let blocks = text.len().div_ceil(16);
        let mut v = vec![blocks as u8];
        v.extend(text.as_bytes());
        v.resize(1 + blocks * 16, 0);
        v
    }

    #[test]
    fn strips_metadata_and_reports_titles() {
        let mut data = Vec::new();
        data.extend([1u8; 10]);
        data.extend(meta("Artist A - Song 1"));
        data.extend([2u8; 10]);
        data.push(0); // empty metadata block
        data.extend([3u8; 10]);
        data.extend(meta("Artist B - Song 2"));
        data.extend([4u8; 5]);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = Arc::clone(&seen);
        let mut r = IcyReader::new(
            Box::new(std::io::Cursor::new(data)),
            Some(10),
            Box::new(move |t| s2.lock().expect("lock").push(t)),
        );
        let mut audio = Vec::new();
        r.read_to_end(&mut audio).expect("read");
        assert_eq!(audio.len(), 35);
        assert!(
            audio.iter().all(|&b| (1..=4).contains(&b)),
            "no metadata bytes in the audio"
        );
        assert_eq!(
            *seen.lock().expect("lock"),
            vec!["Artist A - Song 1", "Artist B - Song 2"]
        );
    }

    #[test]
    fn title_parsing() {
        assert_eq!(
            parse_title(b"StreamTitle='X - Y';StreamUrl='';\0\0").as_deref(),
            Some("X - Y")
        );
        assert_eq!(parse_title(b"StreamTitle='';"), None);
        assert_eq!(parse_title(b"garbage"), None);
    }
}
