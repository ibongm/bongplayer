//! Rust decode fallback for formats WebView2's Media Foundation backend
//! cannot decode natively (FLAC, OGG/Vorbis — see AGENTS.md §6). The
//! frontend only calls this when the browser's decodeAudioData rejects the
//! file first; see src/audio/decode.ts.

use std::io::{Cursor, ErrorKind};

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedAudioPayload {
    pub interleaved_samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_seconds: f64,
}

fn decode_audio_bytes(bytes: Vec<u8>, ext: &str) -> Result<DecodedAudioPayload, String> {
    let cursor = Cursor::new(bytes);
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let mut hint = Hint::new();
    if !ext.is_empty() {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("failed to probe audio format: {error}"))?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "no supported audio track found".to_string())?
        .clone();

    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "audio track has an unknown sample rate".to_string())?;
    let channels = track
        .codec_params
        .channels
        .ok_or_else(|| "audio track has an unknown channel layout".to_string())?
        .count() as u32;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("failed to create decoder: {error}"))?;

    let mut interleaved_samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(ref io_error))
                if io_error.kind() == ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(format!("failed to read packet: {error}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                if sample_buf.is_none() {
                    let spec = *decoded.spec();
                    let duration = decoded.capacity() as u64;
                    sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
                }
                if let Some(buf) = sample_buf.as_mut() {
                    buf.copy_interleaved_ref(decoded);
                    interleaved_samples.extend_from_slice(buf.samples());
                }
            }
            // Decode errors on a single packet are typically recoverable
            // (e.g. a corrupt frame) — skip it and keep decoding.
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(format!("decode error: {error}")),
        }
    }

    if interleaved_samples.is_empty() {
        return Err("decoded zero audio frames".to_string());
    }

    let frame_count = interleaved_samples.len() as f64 / channels as f64;
    let duration_seconds = frame_count / sample_rate as f64;

    Ok(DecodedAudioPayload {
        interleaved_samples,
        sample_rate,
        channels,
        duration_seconds,
    })
}

#[tauri::command]
pub async fn decode_audio(bytes: Vec<u8>, ext: String) -> Result<DecodedAudioPayload, String> {
    // Symphonia decoding is synchronous CPU-bound work — run it on a
    // blocking thread so it never stalls the async IPC executor.
    tauri::async_runtime::spawn_blocking(move || decode_audio_bytes(bytes, &ext))
        .await
        .map_err(|error| format!("decode task panicked: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::decode_audio_bytes;

    /// Builds a minimal mono 16-bit PCM WAV file in memory, for exercising
    /// the real symphonia decode path without needing a fixture file.
    fn make_test_wav(samples: &[i16], sample_rate: u32) -> Vec<u8> {
        let data_size = (samples.len() * 2) as u32;
        let mut bytes = Vec::with_capacity(44 + data_size as usize);

        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        bytes
    }

    #[test]
    fn decodes_a_known_wav_signal() {
        let sample_rate = 8000;
        let samples = [0i16, 16384, 0, -16384, 0, 16384, 0, -16384];
        let wav_bytes = make_test_wav(&samples, sample_rate);

        let payload = decode_audio_bytes(wav_bytes, "wav").expect("decode should succeed");

        assert_eq!(payload.sample_rate, sample_rate);
        assert_eq!(payload.channels, 1);
        assert_eq!(payload.interleaved_samples.len(), samples.len());
        assert!((payload.duration_seconds - samples.len() as f64 / sample_rate as f64).abs() < 1e-9);

        // 16384 / 32768 = 0.5 — symphonia's i16 -> f32 PCM conversion is exact for this value.
        assert!((payload.interleaved_samples[1] - 0.5).abs() < 1e-4);
        assert!((payload.interleaved_samples[3] - (-0.5)).abs() < 1e-4);
    }

    #[test]
    fn rejects_garbage_bytes() {
        let result = decode_audio_bytes(vec![0u8; 16], "wav");
        assert!(result.is_err());
    }
}
