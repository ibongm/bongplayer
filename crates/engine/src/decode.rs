//! Decoding audio files (mp3, flac, wav, m4a/AAC, ogg/Vorbis) into a [`TrackBuffer`].
//!
//! Opening and probing happens on the caller's thread, so a missing, unsupported or corrupt
//! file is reported immediately as an error. The actual decoding runs on a background thread
//! and fills the buffer progressively.

use std::fmt;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::JoinHandle;

use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

use crate::mp4_edit;
use crate::track::{f32_to_i16, TrackBuffer};

/// Why a file could not be opened for playback.
#[derive(Debug)]
pub enum DecodeError {
    NotFound(PathBuf),
    Io(PathBuf, std::io::Error),
    /// The file is not a supported audio format, or is damaged beyond recognition.
    Unsupported(PathBuf, String),
    NoAudioTrack(PathBuf),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(p) => write!(f, "file not found: {}", p.display()),
            Self::Io(p, e) => write!(f, "cannot read {}: {e}", p.display()),
            Self::Unsupported(p, why) => {
                write!(f, "not a playable audio file: {} ({why})", p.display())
            }
            Self::NoAudioTrack(p) => write!(f, "no audio in file: {}", p.display()),
        }
    }
}

impl std::error::Error for DecodeError {}

/// A track whose decoding has started.
pub struct DecodingTrack {
    pub buffer: Arc<TrackBuffer>,
    /// Number of frames the container announces, if it does (may be approximate).
    pub expected_frames: Option<u64>,
    pub channels: usize,
    thread: JoinHandle<()>,
}

impl DecodingTrack {
    /// Blocks until decoding has finished.
    pub fn wait(self) -> Arc<TrackBuffer> {
        // The decode thread never panics on bad input; if it did, the buffer is still
        // valid and marked as failed below.
        if self.thread.join().is_err() && !self.buffer.is_done() {
            self.buffer.fail("decoder thread stopped unexpectedly");
        }
        self.buffer
    }
}

/// A file opened and probed, ready to decode.
struct Opened {
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    params: symphonia::core::codecs::audio::AudioCodecParameters,
    track_id: u32,
    sample_rate: u32,
    channels: usize,
    trim: Option<mp4_edit::AudioEdit>,
    expected_frames: Option<u64>,
}

fn open_audio(path: &Path) -> Result<Opened, DecodeError> {
    let file = File::open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => DecodeError::NotFound(path.to_path_buf()),
        _ => DecodeError::Io(path.to_path_buf(), e),
    })?;

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let unsupported =
        |e: SymphoniaError| DecodeError::Unsupported(path.to_path_buf(), e.to_string());

    let reader = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(unsupported)?;

    let track = reader
        .default_track(TrackType::Audio)
        .ok_or_else(|| DecodeError::NoAudioTrack(path.to_path_buf()))?
        .clone();
    let Some(CodecParameters::Audio(params)) = track.codec_params.clone() else {
        return Err(DecodeError::NoAudioTrack(path.to_path_buf()));
    };
    let sample_rate = params.sample_rate.ok_or_else(|| {
        DecodeError::Unsupported(path.to_path_buf(), "unknown sample rate".into())
    })?;
    let channels = params.channels.as_ref().map_or(2, |c| c.count()).max(1);
    let decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(unsupported)?;

    // MP4 / M4A: Symphonia does not trim the AAC encoder delay and padding, so read the
    // container's edit list ourselves (only if Symphonia reported no delay of its own).
    let trim = if track.delay.is_none() && is_mp4(path) {
        mp4_edit::read_audio_edit(path, sample_rate).ok().flatten()
    } else {
        None
    };
    let expected_frames = trim.map(|t| t.keep_frames).or(track.num_frames);
    Ok(Opened {
        reader,
        decoder,
        params,
        track_id: track.id,
        sample_rate,
        channels,
        trim,
        expected_frames,
    })
}

/// Opens `path` and starts decoding it on a background thread.
pub fn start_decoding(path: &Path) -> Result<DecodingTrack, DecodeError> {
    let o = open_audio(path)?;
    let buffer = Arc::new(TrackBuffer::new(o.sample_rate));
    let job = DecodeJob {
        reader: o.reader,
        decoder: o.decoder,
        params: o.params,
        track_id: o.track_id,
        skip: o.trim.map_or(0, |t| t.skip_frames),
        keep: o.trim.map(|t| t.keep_frames),
    };
    let thread = std::thread::Builder::new()
        .name("bong-decode".into())
        .spawn({
            let buffer = Arc::clone(&buffer);
            move || job.run(&buffer)
        })
        .map_err(|e| DecodeError::Io(path.to_path_buf(), e))?;

    Ok(DecodingTrack {
        buffer,
        expected_frames: o.expected_frames,
        channels: o.channels,
        thread,
    })
}

/// A mono excerpt of a file, for analysis.
#[derive(Debug, Clone)]
pub struct Excerpt {
    pub sample_rate: u32,
    /// Mono samples (average of all channels).
    pub samples: Vec<f32>,
    /// Length of the whole file in frames, if the container says.
    pub total_frames: Option<u64>,
    /// Where the excerpt starts in the file, in frames (approximate after a coarse seek).
    pub start_frame: u64,
}

/// Decodes about `seconds` of mono audio starting near `start_fraction` (0.0 … 1.0) of the
/// file. Used by BPM / key analysis, which does not need the whole file.
pub fn decode_excerpt(
    path: &Path,
    start_fraction: f64,
    seconds: f64,
) -> Result<Excerpt, DecodeError> {
    let mut o = open_audio(path)?;
    let rate = o.sample_rate;
    let mut start_frame = 0u64;
    if let Some(total) = o.expected_frames {
        let want = (total as f64 * start_fraction.clamp(0.0, 0.95)) as u64;
        let secs = (want / u64::from(rate)) as u32;
        if secs > 0 {
            let to = SeekTo::Time {
                time: Time::from(secs),
                track_id: Some(o.track_id),
            };
            if o.reader.seek(SeekMode::Coarse, to).is_ok() {
                o.decoder.reset();
                start_frame = u64::from(secs) * u64::from(rate);
            }
        }
    }
    let wanted = (seconds.max(0.0) * f64::from(rate)) as usize;
    let mut samples = Vec::with_capacity(wanted);
    let mut interleaved: Vec<f32> = Vec::new();
    let mut bad = 0u32;
    while samples.len() < wanted {
        let packet = match o.reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                o.decoder.reset();
                continue;
            }
            Err(e) => return Err(DecodeError::Unsupported(path.to_path_buf(), e.to_string())),
        };
        if packet.track_id != o.track_id {
            continue;
        }
        let decoded = match o.decoder.decode(&packet) {
            Ok(b) => b,
            Err(SymphoniaError::DecodeError(_)) => {
                bad += 1;
                if bad >= MAX_BAD_PACKETS {
                    break;
                }
                continue;
            }
            Err(e) => return Err(DecodeError::Unsupported(path.to_path_buf(), e.to_string())),
        };
        bad = 0;
        let ch = decoded.spec().channels().count().max(1);
        decoded.copy_to_vec_interleaved(&mut interleaved);
        for frame in interleaved.chunks_exact(ch) {
            samples.push(frame.iter().sum::<f32>() / ch as f32);
        }
    }
    samples.truncate(wanted);
    Ok(Excerpt {
        sample_rate: rate,
        samples,
        total_frames: o.expected_frames,
        start_frame,
    })
}

/// Opens and fully decodes `path` before returning.
pub fn decode_to_end(path: &Path) -> Result<Arc<TrackBuffer>, DecodeError> {
    Ok(start_decoding(path)?.wait())
}

fn is_mp4(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        ["m4a", "mp4", "m4b", "aac"]
            .iter()
            .any(|x| e.eq_ignore_ascii_case(x))
    })
}

struct DecodeJob {
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    params: symphonia::core::codecs::audio::AudioCodecParameters,
    track_id: u32,
    /// Frames to drop at the start (encoder delay not handled by Symphonia).
    skip: u64,
    /// Frames to keep in total, if the container says so.
    keep: Option<u64>,
}

/// Consecutive undecodable packets after which a file is given up as corrupt.
const MAX_BAD_PACKETS: u32 = 64;

impl DecodeJob {
    fn run(mut self, buffer: &Arc<TrackBuffer>) {
        match self.decode_all(buffer) {
            Ok(()) => buffer.finish(),
            Err(msg) => buffer.fail(msg),
        }
    }

    fn decode_all(&mut self, buffer: &Arc<TrackBuffer>) -> Result<(), String> {
        let mut samples: Vec<f32> = Vec::new();
        let mut writer = buffer.writer();
        let mut skip = self.skip;
        let mut written: u64 = 0;
        let mut bad_packets = 0u32;

        loop {
            // Nobody holds the track any more (unloaded before decoding finished): stop.
            if Arc::strong_count(buffer) == 1 {
                return Err("cancelled: track was unloaded".into());
            }
            let packet = match self.reader.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => return Ok(()),
                Err(SymphoniaError::IoError(e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    return Ok(());
                }
                Err(SymphoniaError::ResetRequired) => {
                    self.reset_decoder()?;
                    continue;
                }
                Err(e) => return Err(format!("read error: {e}")),
            };
            if packet.track_id != self.track_id {
                continue;
            }
            let decoded = match self.decoder.decode(&packet) {
                Ok(buf) => buf,
                Err(SymphoniaError::DecodeError(msg)) => {
                    bad_packets += 1;
                    if bad_packets >= MAX_BAD_PACKETS {
                        return Err(format!("too many damaged packets ({msg})"));
                    }
                    continue;
                }
                Err(SymphoniaError::ResetRequired) => {
                    self.reset_decoder()?;
                    continue;
                }
                Err(e) => return Err(format!("decode error: {e}")),
            };
            bad_packets = 0;
            let channels = decoded.spec().channels().count().max(1);
            decoded.copy_to_vec_interleaved(&mut samples);

            for frame in samples.chunks_exact(channels) {
                if skip > 0 {
                    skip -= 1;
                    continue;
                }
                if self.keep.is_some_and(|k| written >= k) {
                    return Ok(());
                }
                let (l, r) = downmix(frame);
                if !writer.push(f32_to_i16(l), f32_to_i16(r)) {
                    return Err("track longer than 6 hours; cut off".into());
                }
                written += 1;
            }
        }
    }

    fn reset_decoder(&mut self) -> Result<(), String> {
        self.decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&self.params, &AudioDecoderOptions::default())
            .map_err(|e| format!("decoder reset failed: {e}"))?;
        Ok(())
    }
}

/// Mono → both sides; stereo as is; more channels → even channels left, odd channels right.
fn downmix(frame: &[f32]) -> (f32, f32) {
    match frame {
        [m] => (*m, *m),
        [l, r] => (*l, *r),
        _ => {
            let (mut l, mut r, mut nl, mut nr) = (0.0, 0.0, 0.0f32, 0.0f32);
            for (i, s) in frame.iter().enumerate() {
                if i % 2 == 0 {
                    l += s;
                    nl += 1.0;
                } else {
                    r += s;
                    nr += 1.0;
                }
            }
            (l / nl.max(1.0), r / nr.max(1.0))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_layouts() {
        assert_eq!(downmix(&[0.5]), (0.5, 0.5));
        assert_eq!(downmix(&[0.1, 0.2]), (0.1, 0.2));
        assert_eq!(downmix(&[0.2, 0.4, 0.4, 0.0]), (0.3, 0.2));
    }
}
