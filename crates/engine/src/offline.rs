//! Offline renderer: runs the same engine as the sound card, but into memory or a WAV file.
//! Used by tests to check levels, timing and spectra without speakers.

use std::io::Write;
use std::path::Path;

use crate::engine::{Engine, MAX_BLOCK};

/// Renders `frames` stereo frames, in blocks like a sound card would request them.
pub fn render(engine: &mut Engine, frames: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; 2 * frames];
    for block in out.chunks_mut(2 * MAX_BLOCK) {
        engine.process(block);
    }
    out
}

/// Writes interleaved stereo samples as a 32-bit float WAV file.
pub fn write_wav(path: &Path, sample_rate: u32, samples: &[f32]) -> std::io::Result<()> {
    let data_len = u32::try_from(samples.len() * 4)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "WAV too large"))?;
    let mut w = std::io::BufWriter::new(std::fs::File::create(path)?);
    let channels: u16 = 2;
    let block_align: u16 = channels * 4;
    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data_len).to_le_bytes())?;
    w.write_all(b"WAVEfmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&3u16.to_le_bytes())?; // IEEE float
    w.write_all(&channels.to_le_bytes())?;
    w.write_all(&sample_rate.to_le_bytes())?;
    w.write_all(&(sample_rate * u32::from(block_align)).to_le_bytes())?;
    w.write_all(&block_align.to_le_bytes())?;
    w.write_all(&32u16.to_le_bytes())?;
    w.write_all(b"data")?;
    w.write_all(&data_len.to_le_bytes())?;
    for s in samples {
        w.write_all(&s.to_le_bytes())?;
    }
    w.flush()
}

/// Renders `frames` frames and writes them to a WAV file; returns the samples too.
pub fn render_to_wav(engine: &mut Engine, frames: usize, path: &Path) -> std::io::Result<Vec<f32>> {
    let out = render(engine, frames);
    write_wav(path, engine.sample_rate(), &out)?;
    Ok(out)
}
