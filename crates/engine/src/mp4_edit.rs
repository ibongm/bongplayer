//! Reads the edit list of the audio track in an MP4 / M4A file.
//!
//! AAC encoders add silent "priming" frames at the start and padding at the end. The container
//! records which part is real audio in the edit list (`moov/trak/edts/elst`). Symphonia does not
//! apply it for MP4, so without this every M4A would start ~23 ms late and run long.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioEdit {
    /// Decoded frames to drop at the start.
    pub skip_frames: u64,
    /// Frames to keep after that.
    pub keep_frames: u64,
}

/// Largest `moov` box we are willing to read (it holds only the index, not the audio).
const MAX_MOOV_BYTES: u64 = 64 * 1024 * 1024;

/// Returns the edit of the first sound track, or `None` if the file has no usable edit list.
pub fn read_audio_edit(path: &Path, sample_rate: u32) -> std::io::Result<Option<AudioEdit>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let Some(moov) = find_top_level(&mut file, len, b"moov")? else {
        return Ok(None);
    };
    Ok(parse_moov(&moov, sample_rate))
}

fn find_top_level(file: &mut File, len: u64, name: &[u8; 4]) -> std::io::Result<Option<Vec<u8>>> {
    let mut pos = 0u64;
    while pos + 8 <= len {
        file.seek(SeekFrom::Start(pos))?;
        let mut hdr = [0u8; 16];
        file.read_exact(&mut hdr[..8])?;
        let mut size = u64::from(u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]));
        let mut header_len = 8u64;
        if size == 1 {
            file.read_exact(&mut hdr[8..16])?;
            size = u64::from_be_bytes([
                hdr[8], hdr[9], hdr[10], hdr[11], hdr[12], hdr[13], hdr[14], hdr[15],
            ]);
            header_len = 16;
        } else if size == 0 {
            size = len - pos;
        }
        if size < header_len {
            return Ok(None);
        }
        if &hdr[4..8] == name {
            let body = size - header_len;
            if body > MAX_MOOV_BYTES {
                return Ok(None);
            }
            let mut data = vec![0u8; body as usize];
            file.read_exact(&mut data)?;
            return Ok(Some(data));
        }
        pos += size;
    }
    Ok(None)
}

/// Iterates over the child boxes in `data` as (type, body).
fn boxes(data: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    let mut pos = 0usize;
    std::iter::from_fn(move || {
        let hdr = data.get(pos..pos + 8)?;
        let mut size = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as usize;
        let mut header_len = 8;
        if size == 1 {
            let ext = data.get(pos + 8..pos + 16)?;
            size = u64::from_be_bytes([
                ext[0], ext[1], ext[2], ext[3], ext[4], ext[5], ext[6], ext[7],
            ]) as usize;
            header_len = 16;
        } else if size == 0 {
            size = data.len() - pos;
        }
        if size < header_len {
            return None;
        }
        let body = data.get(pos + header_len..pos + size)?;
        let kind = &hdr[4..8];
        pos += size;
        Some((kind, body))
    })
}

fn child<'a>(data: &'a [u8], name: &[u8; 4]) -> Option<&'a [u8]> {
    boxes(data).find(|(k, _)| *k == name).map(|(_, b)| b)
}

fn be_u32(d: &[u8], at: usize) -> Option<u32> {
    let b = d.get(at..at + 4)?;
    Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

fn be_u64(d: &[u8], at: usize) -> Option<u64> {
    let b = d.get(at..at + 8)?;
    Some(u64::from_be_bytes([
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
    ]))
}

/// Timescale of an `mvhd` or `mdhd` box (same layout for the fields we need).
fn timescale(full_box: &[u8]) -> Option<u32> {
    match full_box.first()? {
        0 => be_u32(full_box, 12),
        1 => be_u32(full_box, 20),
        _ => None,
    }
}

fn parse_moov(moov: &[u8], sample_rate: u32) -> Option<AudioEdit> {
    let movie_ts = timescale(child(moov, b"mvhd")?)?;
    for (_, trak) in boxes(moov).filter(|(k, _)| *k == b"trak") {
        let mdia = child(trak, b"mdia")?;
        let is_sound = child(mdia, b"hdlr").and_then(|h| h.get(8..12)) == Some(b"soun".as_slice());
        if !is_sound {
            continue;
        }
        let media_ts = timescale(child(mdia, b"mdhd")?)?;
        let elst = child(child(trak, b"edts")?, b"elst")?;
        return parse_elst(elst, movie_ts, media_ts, sample_rate);
    }
    None
}

fn parse_elst(elst: &[u8], movie_ts: u32, media_ts: u32, sample_rate: u32) -> Option<AudioEdit> {
    let version = *elst.first()?;
    let count = be_u32(elst, 4)?;
    let mut at = 8;
    let mut skip_media: Option<i64> = None;
    let mut total_movie: u64 = 0;
    for _ in 0..count {
        let (duration, media_time, entry_len) = if version == 1 {
            (be_u64(elst, at)?, be_u64(elst, at + 8)? as i64, 20)
        } else {
            (
                u64::from(be_u32(elst, at)?),
                i64::from(be_u32(elst, at + 4)? as i32),
                12,
            )
        };
        at += entry_len;
        if media_time == -1 {
            // An empty edit (delay before the media starts); not used for audio trimming.
            continue;
        }
        if skip_media.is_none() {
            skip_media = Some(media_time);
        }
        total_movie += duration;
    }
    let skip_media = u64::try_from(skip_media?).ok()?;
    if movie_ts == 0 || media_ts == 0 {
        return None;
    }
    let rate = u128::from(sample_rate);
    let skip_frames = (u128::from(skip_media) * rate / u128::from(media_ts)) as u64;
    let keep_frames =
        ((u128::from(total_movie) * rate + u128::from(movie_ts) / 2) / u128::from(movie_ts)) as u64;
    (keep_frames > 0).then_some(AudioEdit {
        skip_frames,
        keep_frames,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elst_v0(entries: &[(u32, i32)]) -> Vec<u8> {
        let mut v = vec![0, 0, 0, 0];
        v.extend((entries.len() as u32).to_be_bytes());
        for &(d, t) in entries {
            v.extend(d.to_be_bytes());
            v.extend(t.to_be_bytes());
            v.extend(0x0001_0000u32.to_be_bytes());
        }
        v
    }

    #[test]
    fn typical_aac_edit_list() {
        // 2 s in a 1000 Hz movie timescale, starting 1024 frames into 44.1 kHz media.
        let edit = parse_elst(&elst_v0(&[(2000, 1024)]), 1000, 44_100, 44_100);
        assert_eq!(
            edit,
            Some(AudioEdit {
                skip_frames: 1024,
                keep_frames: 88_200
            })
        );
    }

    #[test]
    fn empty_edit_is_ignored() {
        let edit = parse_elst(&elst_v0(&[(500, -1), (1000, 2112)]), 1000, 48_000, 48_000);
        assert_eq!(
            edit,
            Some(AudioEdit {
                skip_frames: 2112,
                keep_frames: 48_000
            })
        );
    }

    #[test]
    fn garbage_is_rejected() {
        assert_eq!(parse_elst(&[1, 2], 1000, 44_100, 44_100), None);
        assert_eq!(parse_moov(&[0, 0, 0, 3, b'x'], 44_100), None);
    }
}
