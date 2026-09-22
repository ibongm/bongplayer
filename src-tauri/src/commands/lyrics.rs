//! Minimal ID3v2 USLT (unsynchronized lyrics) frame reader (Phase 8) — only
//! what src/services/lyrics.ts's ID3 lyrics source needs: no write support,
//! no ID3v1, no other frame types. The frontend only sends a bounded prefix
//! of the file's bytes (ID3v2 tags live at the start of the file, and the
//! tag's own header declares its total size).
//!
//! **Known limitation**: ID3v2.3 frame sizes (plain 32-bit big-endian) are
//! handled correctly; ID3v2.4's syncsafe frame sizes are not — reading them
//! as plain big-endian can under- or over-shoot a frame's true end. This is
//! memory-safe regardless (every offset is clamped to the tag's bounds) but
//! may occasionally miss or mis-slice a v2.4 file's lyrics. Not fixed here
//! since LRCLIB is this feature's primary/more reliable lyrics source (see
//! src/services/lyrics.ts) and full v2.4 support wasn't worth the added
//! complexity for a best-effort fallback.

fn syncsafe_to_u32(bytes: [u8; 4]) -> u32 {
    ((bytes[0] as u32) << 21) | ((bytes[1] as u32) << 14) | ((bytes[2] as u32) << 7) | (bytes[3] as u32)
}

fn decode_utf16(bytes: &[u8], has_bom: bool) -> String {
    let mut data = bytes;
    let mut big_endian = false;
    if has_bom && data.len() >= 2 {
        if data[0] == 0xFE && data[1] == 0xFF {
            big_endian = true;
            data = &data[2..];
        } else if data[0] == 0xFF && data[1] == 0xFE {
            data = &data[2..];
        }
    }
    let units: Vec<u16> = data
        .chunks_exact(2)
        .map(|pair| {
            if big_endian {
                u16::from_be_bytes([pair[0], pair[1]])
            } else {
                u16::from_le_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn decode_text(encoding: u8, bytes: &[u8]) -> String {
    match encoding {
        0 => bytes.iter().map(|&b| b as char).collect(), // ISO-8859-1
        1 => decode_utf16(bytes, true),                  // UTF-16 with BOM
        2 => decode_utf16(bytes, false),                 // UTF-16BE, no BOM
        _ => String::from_utf8_lossy(bytes).to_string(), // 3 = UTF-8
    }
}

/// Byte offset just past the null-terminated content-descriptor field that
/// precedes a USLT frame's actual lyrics text (1 or 2 null bytes, depending
/// on the frame's text encoding).
fn find_text_terminator(bytes: &[u8], encoding: u8) -> Option<usize> {
    if encoding == 1 || encoding == 2 {
        bytes
            .chunks_exact(2)
            .position(|pair| pair == [0, 0])
            .map(|idx| idx * 2 + 2)
    } else {
        bytes.iter().position(|&b| b == 0).map(|idx| idx + 1)
    }
}

/// Scans the given bytes (expected to be the start of an MP3 file) for an
/// ID3v2 tag and returns the first USLT frame's lyrics text, if any.
pub fn extract_uslt_lyrics(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 10 || &bytes[0..3] != b"ID3" {
        return None;
    }
    let major_version = bytes[3];
    if major_version < 3 {
        return None; // ID3v2.2 uses 3-char frame IDs — a different format, not handled here
    }

    let tag_size = syncsafe_to_u32([bytes[6], bytes[7], bytes[8], bytes[9]]) as usize;
    let tag_end = (10 + tag_size).min(bytes.len());
    let mut offset = 10;

    while offset + 10 <= tag_end {
        let frame_id = &bytes[offset..offset + 4];
        if frame_id == [0, 0, 0, 0] {
            break; // padding — no more real frames follow
        }
        let frame_size = u32::from_be_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let frame_start = offset + 10;
        let frame_end = (frame_start + frame_size).min(tag_end);

        if frame_id == b"USLT" && frame_end > frame_start + 4 {
            let frame_data = &bytes[frame_start..frame_end];
            let encoding = frame_data[0];
            // frame_data[1..4] is the 3-byte ISO-639-2 language code.
            let after_lang = &frame_data[4..];
            let text_start = find_text_terminator(after_lang, encoding).unwrap_or(0);
            let lyrics = decode_text(encoding, &after_lang[text_start..])
                .trim_end_matches('\0')
                .to_string();
            if !lyrics.trim().is_empty() {
                return Some(lyrics);
            }
        }

        offset = frame_end;
    }

    None
}

#[tauri::command]
pub fn read_embedded_lyrics(bytes: Vec<u8>) -> Option<String> {
    extract_uslt_lyrics(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_id3v2_with_uslt(lyrics: &str) -> Vec<u8> {
        let mut frame_body = Vec::new();
        frame_body.push(0u8); // ISO-8859-1 encoding
        frame_body.extend_from_slice(b"eng"); // language
        frame_body.push(0u8); // empty content descriptor, null-terminated
        frame_body.extend_from_slice(lyrics.as_bytes());

        let mut frame = Vec::new();
        frame.extend_from_slice(b"USLT");
        frame.extend_from_slice(&(frame_body.len() as u32).to_be_bytes());
        frame.extend_from_slice(&[0u8, 0u8]); // flags
        frame.extend_from_slice(&frame_body);

        let tag_size = frame.len() as u32;
        let syncsafe = [
            ((tag_size >> 21) & 0x7F) as u8,
            ((tag_size >> 14) & 0x7F) as u8,
            ((tag_size >> 7) & 0x7F) as u8,
            (tag_size & 0x7F) as u8,
        ];

        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"ID3");
        bytes.extend_from_slice(&[3, 0]); // version 2.3.0
        bytes.push(0); // flags
        bytes.extend_from_slice(&syncsafe);
        bytes.extend_from_slice(&frame);
        bytes
    }

    #[test]
    fn extracts_lyrics_from_a_uslt_frame() {
        let bytes = build_id3v2_with_uslt("[00:01.00]Hello\n[00:02.00]World");
        assert_eq!(
            extract_uslt_lyrics(&bytes),
            Some("[00:01.00]Hello\n[00:02.00]World".to_string())
        );
    }

    #[test]
    fn returns_none_when_no_id3_tag_present() {
        assert_eq!(extract_uslt_lyrics(b"not an id3 file at all"), None);
    }

    #[test]
    fn returns_none_when_id3_tag_has_no_uslt_frame() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"ID3");
        bytes.extend_from_slice(&[3, 0, 0, 0, 0, 0, 0]); // zero-size tag
        assert_eq!(extract_uslt_lyrics(&bytes), None);
    }

    #[test]
    fn returns_none_for_id3v22_tags() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"ID3");
        bytes.extend_from_slice(&[2, 0, 0, 0, 0, 0, 0]);
        assert_eq!(extract_uslt_lyrics(&bytes), None);
    }
}
