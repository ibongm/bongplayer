//! LOCK: one switch that stops staff from changing the music by accident.
//!
//! While locked, transport (play, pause, seek, cue, loops, sync, scratch), loading tracks,
//! the crossfader, pitch, Automix start/stop/skip and queue edits are refused — in Rust, so
//! it holds whatever the screen does. Volume (master, channel faders, DUCK) stays adjustable
//! unless that option is switched off. Unlock with the PIN, or by holding the LOCK button
//! (if allowed).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::{err, lock, AppResult, AppState};

pub const SETTINGS_KEY: &str = "lock.settings";
pub const LOCKED_KEY: &str = "lock.locked";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockSettings {
    /// Master / channel volume and DUCK still work while locked.
    pub volume_allowed: bool,
    /// Holding the LOCK button (2 s) unlocks without the PIN.
    pub hold_unlocks: bool,
    /// Salted SHA-256 of the PIN as "salt:hash" (hex); None = no PIN set.
    pub pin_hash: Option<String>,
}

impl Default for LockSettings {
    fn default() -> Self {
        Self {
            volume_allowed: true,
            hold_unlocks: true,
            pin_hash: None,
        }
    }
}

#[derive(Debug, Default)]
pub struct LockState {
    pub locked: bool,
    pub settings: LockSettings,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(b":");
    h.update(pin.as_bytes());
    hex(&h.finalize())
}

fn new_salt() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let mut h = Sha256::new();
    h.update(nanos.to_le_bytes());
    h.update(std::process::id().to_le_bytes());
    hex(&h.finalize()[..8])
}

pub fn verify_pin(stored: &str, pin: &str) -> bool {
    match stored.split_once(':') {
        Some((salt, hash)) => hash_pin(salt, pin) == hash,
        None => false,
    }
}

/// What a command does, for the lock check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Volume-type controls (allowed while locked if the option is on).
    Volume,
    /// Anything that changes what plays or how (always refused while locked).
    Music,
}

impl AppState {
    pub fn lock_check(&self, action: Action) -> AppResult<()> {
        let l = lock(&self.lock);
        if !l.locked || (action == Action::Volume && l.settings.volume_allowed) {
            return Ok(());
        }
        Err("Locked — unlock with the PIN or by holding LOCK".into())
    }

    fn save_lock(&self) -> AppResult<()> {
        let (locked, settings) = {
            let l = lock(&self.lock);
            (l.locked, l.settings.clone())
        };
        let lib = lock(&self.library);
        lib.set_setting(LOCKED_KEY, if locked { "1" } else { "0" })
            .map_err(err)?;
        lib.set_setting(
            SETTINGS_KEY,
            &serde_json::to_string(&settings).map_err(err)?,
        )
        .map_err(err)
    }

    pub fn load_lock(&self) {
        let lib = lock(&self.library);
        let settings = lib
            .setting(SETTINGS_KEY)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str::<LockSettings>(&s).ok())
            .unwrap_or_default();
        let locked = lib.setting(LOCKED_KEY).ok().flatten().as_deref() == Some("1");
        drop(lib);
        let mut l = lock(&self.lock);
        l.settings = settings;
        l.locked = locked;
    }

    pub fn lock_engage(&self) -> AppResult<()> {
        lock(&self.lock).locked = true;
        self.save_lock()
    }

    /// Unlocks with the PIN, or by a long press (`hold`) if allowed.
    pub fn lock_release(&self, pin: Option<&str>, hold: bool) -> AppResult<()> {
        {
            let mut l = lock(&self.lock);
            if !l.locked {
                return Ok(());
            }
            let by_hold = hold && l.settings.hold_unlocks;
            let by_pin = match (&l.settings.pin_hash, pin) {
                (Some(stored), Some(p)) => verify_pin(stored, p),
                // No PIN configured: a plain unlock works.
                (None, _) => !hold || l.settings.hold_unlocks,
                (Some(_), None) => false,
            };
            if !(by_hold || by_pin) {
                return Err(if hold {
                    "Unlocking by holding LOCK is switched off — enter the PIN".into()
                } else {
                    "Wrong PIN".into()
                });
            }
            l.locked = false;
        }
        self.save_lock()
    }

    /// Changes the lock options. Setting a new PIN (or removing it) needs the current PIN
    /// when one is set.
    pub fn lock_configure(
        &self,
        volume_allowed: bool,
        hold_unlocks: bool,
        current_pin: Option<&str>,
        new_pin: Option<Option<&str>>,
    ) -> AppResult<()> {
        {
            let mut l = lock(&self.lock);
            if let Some(change) = new_pin {
                if let Some(stored) = &l.settings.pin_hash {
                    if !current_pin.is_some_and(|p| verify_pin(stored, p)) {
                        return Err("Enter the current PIN to change it".into());
                    }
                }
                l.settings.pin_hash = match change {
                    Some(p) => {
                        if p.len() < 4 || !p.chars().all(|c| c.is_ascii_digit()) {
                            return Err("The PIN must be at least 4 digits".into());
                        }
                        let salt = new_salt();
                        Some(format!("{salt}:{}", hash_pin(&salt, p)))
                    }
                    None => None,
                };
            }
            l.settings.volume_allowed = volume_allowed;
            l.settings.hold_unlocks = hold_unlocks;
        }
        self.save_lock()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_hash_verifies_and_rejects() {
        let salt = new_salt();
        let stored = format!("{salt}:{}", hash_pin(&salt, "2468"));
        assert!(verify_pin(&stored, "2468"));
        assert!(!verify_pin(&stored, "2469"));
        assert!(!verify_pin("garbage", "2468"));
        assert!(!stored.contains("2468"), "the PIN itself is never stored");
    }
}
