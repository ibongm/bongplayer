//! Sampler pads (glue): which sound is on which pad, its volume and choke group. Saved in the
//! settings and loaded again at start-up; sounds are decoded off the audio thread.

use std::path::{Path, PathBuf};

use engine::sampler::{Sample, CHOKE_GROUPS, MAX_SAMPLE_SECONDS, PADS};
use engine::Command;
use serde::{Deserialize, Serialize};

use crate::lock::Action;
use crate::state::{err, lock, AppResult, AppState};

/// Settings key of the pad layout (JSON).
pub const PADS_KEY: &str = "sampler.pads";

/// What is saved per pad.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadConfig {
    pub path: Option<PathBuf>,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub choke: u8,
}

/// A pad as the screen shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadInfo {
    pub index: usize,
    /// File name without extension ("" when empty).
    pub name: String,
    pub path: Option<String>,
    pub gain_db: f32,
    pub choke: u8,
    /// Length of the loaded sound.
    pub seconds: Option<f64>,
    /// Why the saved sound could not be loaded (missing file …).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PadSlot {
    config: PadConfig,
    seconds: Option<f64>,
    error: Option<String>,
}

fn check_pad(pad: usize) -> AppResult<()> {
    if pad < PADS {
        Ok(())
    } else {
        Err(format!("there are {PADS} pads (1–{PADS})"))
    }
}

/// Decodes a sound for a pad; refuses files longer than the limit before decoding them whole.
fn decode_sample(path: &Path) -> AppResult<Sample> {
    let decoding = engine::start_decoding(path).map_err(err)?;
    let rate = f64::from(decoding.buffer.sample_rate().max(1));
    if let Some(frames) = decoding.expected_frames {
        let seconds = frames as f64 / rate;
        // Container lengths can be a little off; the exact check follows below.
        if seconds > MAX_SAMPLE_SECONDS + 1.0 {
            return Err(format!(
                "the sound is {seconds:.0} s long; pads take sounds up to {MAX_SAMPLE_SECONDS:.0} s"
            ));
        }
    }
    let buffer = decoding.wait();
    if let engine::DecodeState::Failed(why) = buffer.state() {
        return Err(format!("could not decode {}: {why}", path.display()));
    }
    Sample::from_track(&buffer).map_err(err)
}

impl AppState {
    pub fn sampler_pads(&self) -> Vec<PadInfo> {
        let slots = lock(&self.sampler);
        slots
            .iter()
            .enumerate()
            .map(|(index, s)| PadInfo {
                index,
                name: s
                    .config
                    .path
                    .as_deref()
                    .and_then(Path::file_stem)
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: s.config.path.as_ref().map(|p| p.display().to_string()),
                gain_db: s.config.gain_db,
                choke: s.config.choke,
                seconds: s.seconds,
                error: s.error.clone(),
            })
            .collect()
    }

    fn save_pads(&self) -> AppResult<()> {
        let configs: Vec<PadConfig> = lock(&self.sampler)
            .iter()
            .map(|s| s.config.clone())
            .collect();
        let json = serde_json::to_string(&configs).map_err(err)?;
        lock(&self.library)
            .set_setting(PADS_KEY, &json)
            .map_err(err)
    }

    /// Sends a pad's sound and settings to the engine.
    fn apply_pad(&self, pad: usize, sample: Option<Sample>) -> AppResult<()> {
        let (gain_db, choke) = {
            let s = lock(&self.sampler);
            (s[pad].config.gain_db, s[pad].config.choke)
        };
        let mut engine = lock(&self.engine);
        match sample {
            Some(sample) => engine.load_pad(pad, sample).map_err(err)?,
            None => engine
                .send(Command::LoadPad { pad, sample: None })
                .map_err(err)?,
        }
        engine
            .send(Command::SetPadGainDb { pad, db: gain_db })
            .map_err(err)?;
        engine
            .send(Command::SetPadChoke { pad, group: choke })
            .map_err(err)
    }

    /// Puts a sound file on a pad.
    pub fn sampler_load(&self, pad: usize, path: &Path) -> AppResult<Vec<PadInfo>> {
        check_pad(pad)?;
        self.lock_check(Action::Music)?;
        let sample = decode_sample(path)?;
        let seconds = sample.seconds();
        {
            let mut slots = lock(&self.sampler);
            let s = &mut slots[pad];
            s.config.path = Some(path.to_path_buf());
            s.seconds = Some(seconds);
            s.error = None;
        }
        self.apply_pad(pad, Some(sample))?;
        self.save_pads()?;
        Ok(self.sampler_pads())
    }

    pub fn sampler_clear(&self, pad: usize) -> AppResult<Vec<PadInfo>> {
        check_pad(pad)?;
        self.lock_check(Action::Music)?;
        lock(&self.sampler)[pad] = PadSlot::default();
        self.apply_pad(pad, None)?;
        self.save_pads()?;
        Ok(self.sampler_pads())
    }

    /// Pad volume (−∞ … +6 dB; −60 or lower = off) and choke group (0 = none, 1–4).
    pub fn sampler_configure(
        &self,
        pad: usize,
        gain_db: f32,
        choke: u8,
    ) -> AppResult<Vec<PadInfo>> {
        check_pad(pad)?;
        self.lock_check(Action::Music)?;
        if !gain_db.is_finite() {
            return Err("pad volume must be a number".into());
        }
        if choke > CHOKE_GROUPS {
            return Err(format!("choke group must be 0 (none) or 1–{CHOKE_GROUPS}"));
        }
        let gain_db = gain_db.clamp(-120.0, 6.0);
        {
            let mut slots = lock(&self.sampler);
            slots[pad].config.gain_db = gain_db;
            slots[pad].config.choke = choke;
        }
        self.send(Command::SetPadGainDb { pad, db: gain_db })?;
        self.send(Command::SetPadChoke { pad, group: choke })?;
        self.save_pads()?;
        Ok(self.sampler_pads())
    }

    /// Plays a pad (allowed while locked: it changes no music, the DJ may need a jingle).
    pub fn sampler_trigger(&self, pad: usize) -> AppResult<()> {
        check_pad(pad)?;
        let loaded = lock(&self.sampler)[pad].seconds.is_some();
        if !loaded {
            return Err(format!("pad {} is empty — drop a sound on it", pad + 1));
        }
        self.send(Command::TriggerPad(pad))
    }

    /// Stops one pad, or all of them.
    pub fn sampler_stop(&self, pad: Option<usize>) -> AppResult<()> {
        match pad {
            Some(p) => {
                check_pad(p)?;
                self.send(Command::StopPad(p))
            }
            None => self.send(Command::StopAllPads),
        }
    }

    /// Loads the saved pads (at start-up). A missing or broken file leaves its pad showing
    /// the problem; the other pads still load.
    pub fn sampler_restore(&self) {
        let saved = lock(&self.library).setting(PADS_KEY).ok().flatten();
        let Some(configs) = saved.and_then(|j| serde_json::from_str::<Vec<PadConfig>>(&j).ok())
        else {
            return;
        };
        for (pad, config) in configs.into_iter().enumerate().take(PADS) {
            let sample = config.path.as_deref().map(decode_sample);
            {
                let mut slots = lock(&self.sampler);
                let s = &mut slots[pad];
                s.config = PadConfig {
                    choke: config.choke.min(CHOKE_GROUPS),
                    gain_db: if config.gain_db.is_finite() {
                        config.gain_db.clamp(-120.0, 6.0)
                    } else {
                        0.0
                    },
                    path: config.path,
                };
                match &sample {
                    Some(Ok(smp)) => {
                        s.seconds = Some(smp.seconds());
                        s.error = None;
                    }
                    Some(Err(e)) => {
                        s.seconds = None;
                        s.error = Some(e.clone());
                    }
                    None => {}
                }
            }
            let _ = self.apply_pad(pad, sample.and_then(Result::ok));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pad_config_reads_older_or_partial_json() {
        let v: Vec<PadConfig> =
            serde_json::from_str(r#"[{"path":"C:\\x.wav"},{"path":null,"gainDb":-6,"choke":2}]"#)
                .expect("json");
        assert_eq!(v[0].gain_db, 0.0);
        assert_eq!(v[1].choke, 2);
    }
}
