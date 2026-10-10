//! Automix: plays the queue unattended, with transitions between tracks.
//!
//! A controller `tick` runs about 20 times a second (and in tests, between offline-rendered
//! blocks). It never waits: each tick looks at the decks and the queue and issues commands.
//! - Starts the first track when switched on.
//! - Loads the next track onto the other deck in good time (`PRELOAD_SECONDS` before the
//!   transition), skipping files that are missing or cannot be decoded.
//! - Starts the transition when the playing track has `trigger_seconds` left.
//! - When the transition has finished: counts the play, removes the track (Auto-remove) or
//!   marks it played; at the end of the queue starts again from the top (Loop).
//! - If a deck stops unexpectedly (end of file without a transition, a stuck deck), the next
//!   track starts immediately: never dead air while there is something to play.

use std::collections::{HashSet, VecDeque};

use engine::{Command, DeckId, TransitionStyle};
use serde::{Deserialize, Serialize};

use crate::state::{err, lock, AppResult, AppState, DeckName};

/// Seconds before the transition point at which the next track is loaded.
pub const PRELOAD_SECONDS: f64 = 20.0;
/// A playing deck whose position does not move for this long is treated as stuck.
pub const STALL_SECONDS: f64 = 3.0;
/// Tracks tried per tick when files turn out to be unplayable.
const MAX_SKIPS_PER_TICK: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Style {
    Smooth,
    BassSwap,
    Cut,
    EchoOut,
}

impl From<Style> for TransitionStyle {
    fn from(s: Style) -> Self {
        match s {
            Style::Smooth => TransitionStyle::Smooth,
            Style::BassSwap => TransitionStyle::BassSwap,
            Style::Cut => TransitionStyle::Cut,
            Style::EchoOut => TransitionStyle::EchoOut,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomixConfig {
    /// The transition starts when the playing track has this many seconds left.
    pub trigger_seconds: f64,
    /// Length of the transition (never longer than the trigger time).
    pub crossfade_seconds: f64,
    pub style: Style,
    /// At the end of the queue, start again from the top.
    pub loop_queue: bool,
    /// Pick the next track at random (each track once per round).
    pub shuffle: bool,
    /// Remove tracks from the queue once they have played.
    pub auto_remove: bool,
}

impl Default for AutomixConfig {
    fn default() -> Self {
        Self {
            trigger_seconds: 8.0,
            crossfade_seconds: 6.0,
            style: Style::Smooth,
            loop_queue: true,
            shuffle: false,
            auto_remove: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub deck: DeckName,
    pub uid: u64,
    pub track_id: i64,
    /// Set when the entry is a radio station.
    #[serde(default)]
    pub station_id: Option<i64>,
}

#[derive(Debug, Default)]
pub struct Automix {
    pub on: bool,
    pub config: AutomixConfig,
    pub current: Option<Slot>,
    pub next: Option<Slot>,
    /// Queue entries already played (or found unplayable) in this round.
    pub played: HashSet<u64>,
    /// The transition from `current` to `next` has been started.
    pub transitioning: bool,
    transitions_seen: u64,
    /// Last position of the current deck and when it last moved (stall detection).
    watch: Option<(f64, f64)>,
    /// Recent events for the user ("skipped …: file not found").
    pub messages: VecDeque<String>,
    /// DUCK is engaged (shown on the button).
    pub duck_on: bool,
}

impl Automix {
    fn say(&mut self, msg: String) {
        if self.messages.len() >= 20 {
            self.messages.pop_front();
        }
        self.messages.push_back(msg);
    }
}

fn other(deck: DeckName) -> DeckName {
    if deck == DeckName::A {
        DeckName::B
    } else {
        DeckName::A
    }
}

fn xf_for(deck: DeckName) -> f32 {
    if deck == DeckName::A {
        0.0
    } else {
        1.0
    }
}

/// Simple deterministic generator for Shuffle (no external crate needed).
fn pseudo_random(seed: u64) -> u64 {
    let mut x = seed ^ 0x9E37_79B9_7F4A_7C15;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

impl AppState {
    /// The next queue entry to play, honouring Shuffle and Loop.
    fn pick_next(&self, am: &mut Automix, seed: u64) -> Option<crate::state::QueueItem> {
        let items = lock(&self.queue).items().to_vec();
        let busy: HashSet<u64> = [am.current, am.next]
            .iter()
            .flatten()
            .map(|s| s.uid)
            .collect();
        let candidates = |played: &HashSet<u64>| -> Vec<crate::state::QueueItem> {
            items
                .iter()
                .filter(|i| !played.contains(&i.uid) && !busy.contains(&i.uid))
                .cloned()
                .collect()
        };
        let mut list = candidates(&am.played);
        if list.is_empty() && am.config.loop_queue && !items.is_empty() {
            // New round: everything (except what is on the decks) can play again.
            am.played.clear();
            list = candidates(&am.played);
        }
        if list.is_empty() {
            return None;
        }
        let i = if am.config.shuffle {
            (pseudo_random(seed) % list.len() as u64) as usize
        } else {
            0
        };
        list.get(i).cloned()
    }

    /// Loads a queue entry on a deck (stopped). Unplayable files are marked and reported.
    fn prepare(&self, am: &mut Automix, deck: DeckName, seed: u64) -> Option<Slot> {
        for n in 0..MAX_SKIPS_PER_TICK {
            let item = self.pick_next(am, seed.wrapping_add(n as u64))?;
            let (uid, track_id) = (item.uid, item.track_id);
            let loaded = match item.station_id {
                Some(sid) => self.load_saved_station(deck, sid),
                None => self.load_track(deck, track_id),
            };
            match loaded {
                Ok(row) => {
                    let _ = self.send(Command::Pause(deck.id()));
                    let _ = row;
                    return Some(Slot {
                        deck,
                        uid,
                        track_id,
                        station_id: item.station_id,
                    });
                }
                Err(e) => {
                    am.played.insert(uid);
                    am.say(format!("skipped a queued track: {e}"));
                }
            }
        }
        None
    }

    fn deck_track(&self, deck: DeckName) -> Option<crate::state::DeckTrack> {
        lock(&self.decks)[deck.index()].clone()
    }

    /// Seconds left on a deck (None while the length is unknown). A station "ends" after its
    /// play time.
    fn remaining(&self, deck: DeckName) -> Option<f64> {
        let d = self.deck_track(deck)?;
        let rate = f64::from(d.sample_rate());
        let pos = self.status.deck(deck.id()).position() / rate;
        if let Some(l) = d.live() {
            return Some(f64::from(l.play_minutes) * 60.0 - pos);
        }
        let total = d.total_frames()? as f64 / rate;
        Some(total - pos)
    }

    /// Whether a prepared deck has audio ready (or failed).
    fn readiness(&self, deck: DeckName) -> Result<bool, String> {
        let Some(d) = self.deck_track(deck) else {
            return Err("nothing loaded".into());
        };
        if let Some(l) = d.live() {
            let st = l.live.state();
            if let Some(e) = st.strip_prefix("error: ") {
                return Err(format!("{}: {e}", l.name));
            }
            let pre = engine::deck::LIVE_PREBUFFER_SECONDS * f64::from(l.live.sample_rate());
            return Ok(l.live.written() as f64 >= pre);
        }
        let Some(buf) = d.file().cloned() else {
            return Err("nothing loaded".into());
        };
        if let engine::DecodeState::Failed(e) = buf.state() {
            if buf.frames_ready() == 0 {
                return Err(e);
            }
        }
        Ok(buf.frames_ready() > 0)
    }

    fn start_fresh(&self, am: &mut Automix, deck: DeckName, seed: u64) {
        am.transitioning = false;
        am.next = None;
        if let Some(slot) = self.prepare(am, deck, seed) {
            let _ = self.send(Command::SetCrossfader(xf_for(deck)));
            let _ = self.send(Command::Play(deck.id()));
            am.current = Some(slot);
            am.watch = None;
        } else {
            am.current = None;
        }
    }

    fn finish_track(&self, am: &mut Automix, slot: Slot) {
        // Stations (negative ids in the deck row) are not counted as track plays.
        if slot.track_id > 0 {
            if let Err(e) = lock(&self.library).mark_played(&[slot.track_id]) {
                am.say(format!("could not count the play: {e}"));
            }
        }
        if am.config.auto_remove {
            lock(&self.queue).remove(&[slot.uid]);
            am.played.remove(&slot.uid);
        } else {
            am.played.insert(slot.uid);
        }
    }

    /// One controller step. `now` is a monotonic time in seconds; `seed` varies per call
    /// (used by Shuffle).
    pub fn automix_tick(&self, now: f64, seed: u64) {
        let mut am = lock(&self.automix);
        if !am.on {
            return;
        }
        let cfg = am.config;
        let trigger = cfg.trigger_seconds.max(0.5);
        let fade = cfg.crossfade_seconds.clamp(0.0, trigger);

        let Some(cur) = am.current else {
            let deck = if self.status.deck(DeckId::A).is_playing() {
                DeckName::B
            } else {
                DeckName::A
            };
            self.start_fresh(&mut am, deck, seed);
            if am.current.is_none() && am.messages.back().is_none_or(|m| !m.starts_with("queue")) {
                am.say("queue is empty: add tracks to Automix".into());
            }
            return;
        };

        // A transition we started has finished: the next track becomes the current one.
        let done = self.status.transitions_done();
        if am.transitioning && done > am.transitions_seen {
            am.transitions_seen = done;
            am.transitioning = false;
            self.finish_track(&mut am, cur);
            am.current = am.next.take();
            am.watch = None;
            return;
        }
        am.transitions_seen = done;
        if am.transitioning {
            return;
        }

        let st = self.status.deck(cur.deck.id());
        let position = st.position();
        // The current track stopped by itself (ended, failed, stuck): move on at once.
        let stalled = match am.watch {
            Some((p, since)) if st.is_playing() && (p - position).abs() < 1e-9 => {
                now - since > STALL_SECONDS
            }
            _ => {
                am.watch = Some((position, now));
                false
            }
        };
        let failed = self.readiness(cur.deck).is_err();
        // A deck the DJ paused on purpose is left alone (Automix waits).
        if st.has_ended() || stalled || failed {
            let reason = if failed {
                "the file could not be read"
            } else if stalled {
                "the deck stopped responding"
            } else {
                "it stopped"
            };
            if !st.has_ended() {
                am.say(format!("moved on from a track because {reason}"));
            }
            self.finish_track(&mut am, cur);
            match am.next.take() {
                Some(next) if self.readiness(next.deck).is_ok() => {
                    let _ = self.send(Command::Pause(cur.deck.id()));
                    let _ = self.send(Command::SetCrossfader(xf_for(next.deck)));
                    let _ = self.send(Command::Play(next.deck.id()));
                    am.current = Some(next);
                    am.watch = None;
                }
                _ => self.start_fresh(&mut am, other(cur.deck), seed),
            }
            return;
        }

        let Some(remaining) = self.remaining(cur.deck) else {
            return;
        };
        // Load the next track in good time.
        if am.next.is_none() && remaining <= trigger + PRELOAD_SECONDS {
            am.next = self.prepare(&mut am, other(cur.deck), seed);
        }
        // Start the transition at the trigger point.
        if remaining <= trigger {
            if let Some(next) = am.next {
                match self.readiness(next.deck) {
                    Ok(true) => {
                        let bpm = self.track_bpm(next.deck).unwrap_or(120.0);
                        let _ = self.send(Command::Play(next.deck.id()));
                        let _ = self.send(Command::StartTransition {
                            from: cur.deck.id(),
                            to: next.deck.id(),
                            style: cfg.style.into(),
                            seconds: fade,
                            echo_seconds: 60.0 / bpm,
                        });
                        am.transitioning = true;
                    }
                    Ok(false) => {} // still decoding: try again next tick
                    Err(e) => {
                        am.say(format!("skipped a queued track: {e}"));
                        am.played.insert(next.uid);
                        am.next = None;
                    }
                }
            }
        }
    }

    pub fn automix_start(&self) -> AppResult<()> {
        let mut am = lock(&self.automix);
        if am.on {
            return Ok(());
        }
        am.on = true;
        am.transitions_seen = self.status.transitions_done();
        // Adopt a track that is already playing (e.g. the DJ started Automix mid-song).
        if am.current.is_none() {
            for deck in [DeckName::A, DeckName::B] {
                if self.status.deck(deck.id()).is_playing() {
                    if let Some(row) = lock(&self.decks)[deck.index()].as_ref().map(|d| d.row.id) {
                        am.current = Some(Slot {
                            deck,
                            uid: 0,
                            track_id: row,
                            station_id: None,
                        });
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn automix_stop(&self) {
        let mut am = lock(&self.automix);
        am.on = false;
        am.next = None;
        if am.transitioning {
            let _ = self.send(Command::CancelTransition);
            am.transitioning = false;
        }
    }

    /// Starts the transition to the next track right now.
    pub fn automix_skip(&self, now: f64, seed: u64) -> AppResult<()> {
        {
            let mut am = lock(&self.automix);
            if !am.on {
                return Err("Automix is off".into());
            }
            let Some(cur) = am.current else {
                return Err("nothing is playing".into());
            };
            if am.transitioning {
                return Ok(());
            }
            if am.next.is_none() {
                am.next = self.prepare(&mut am, other(cur.deck), seed);
            }
            if am.next.is_none() {
                return Err("there is no next track in the queue".into());
            }
            // Pretend the trigger point has come: shift the config for this one tick.
            let saved = am.config.trigger_seconds;
            am.config.trigger_seconds = f64::MAX / 4.0;
            drop(am);
            self.automix_tick(now, seed);
            lock(&self.automix).config.trigger_seconds = saved;
        }
        Ok(())
    }

    pub fn automix_set_config(&self, config: AutomixConfig) -> AppResult<()> {
        if !(config.trigger_seconds.is_finite() && config.crossfade_seconds.is_finite()) {
            return Err("invalid Automix setting".into());
        }
        let mut c = config;
        c.trigger_seconds = c.trigger_seconds.clamp(1.0, 60.0);
        c.crossfade_seconds = c.crossfade_seconds.clamp(0.0, 30.0);
        lock(&self.automix).config = c;
        let json = serde_json::to_string(&c).map_err(err)?;
        lock(&self.library)
            .set_setting(CONFIG_KEY, &json)
            .map_err(err)
    }
}

pub const CONFIG_KEY: &str = "automix.config";

// ----- resume after a crash or reboot -----

pub const STATE_KEY: &str = "automix.state";

/// What is saved every few seconds so playback can resume after a crash or reboot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedState {
    pub on: bool,
    pub queue: Vec<crate::state::QueueItem>,
    pub current: Option<Slot>,
    /// Position of the current track in seconds.
    pub position: f64,
    pub played: Vec<u64>,
}

impl AppState {
    pub fn automix_snapshot(&self) -> SavedState {
        let am = lock(&self.automix);
        let position = am.current.map_or(0.0, |c| {
            let rate = lock(&self.decks)[c.deck.index()]
                .as_ref()
                .map_or(44_100.0, |d| f64::from(d.sample_rate()));
            self.status.deck(c.deck.id()).position() / rate
        });
        SavedState {
            on: am.on,
            queue: lock(&self.queue).items().to_vec(),
            current: am.current,
            position,
            played: am.played.iter().copied().collect(),
        }
    }

    pub fn automix_save(&self) -> AppResult<()> {
        let json = serde_json::to_string(&self.automix_snapshot()).map_err(err)?;
        lock(&self.library)
            .set_setting(STATE_KEY, &json)
            .map_err(err)
    }

    /// Restores config, queue and (if Automix was on) the current track at its position,
    /// playing. Returns whether playback was resumed.
    pub fn automix_restore(&self) -> AppResult<bool> {
        let (config, saved) = {
            let lib = lock(&self.library);
            let config = lib
                .setting(CONFIG_KEY)
                .map_err(err)?
                .and_then(|s| serde_json::from_str::<AutomixConfig>(&s).ok());
            let saved = lib
                .setting(STATE_KEY)
                .map_err(err)?
                .and_then(|s| serde_json::from_str::<SavedState>(&s).ok());
            (config, saved)
        };
        if let Some(c) = config {
            lock(&self.automix).config = c;
        }
        let Some(saved) = saved else {
            return Ok(false);
        };
        lock(&self.queue).restore(saved.queue);
        {
            let mut am = lock(&self.automix);
            am.played = saved.played.into_iter().collect();
            am.on = saved.on;
        }
        if !saved.on {
            return Ok(false);
        }
        let Some(cur) = saved.current else {
            return Ok(false);
        };
        let loaded = match cur.station_id {
            Some(sid) => self.load_saved_station(cur.deck, sid),
            None => self.load_track(cur.deck, cur.track_id),
        };
        match loaded {
            Ok(_) if cur.station_id.is_some() => {
                // A station resumes live (there is no position to go back to).
                self.send(Command::SetCrossfader(xf_for(cur.deck)))?;
                self.send(Command::Play(cur.deck.id()))?;
                let mut am = lock(&self.automix);
                am.current = Some(cur);
                am.transitions_seen = self.status.transitions_done();
                Ok(true)
            }
            Ok(_) => {
                let rate = self.file_rate(cur.deck).unwrap_or(44_100);
                self.send(Command::Seek {
                    deck: cur.deck.id(),
                    frame: saved.position.max(0.0) * f64::from(rate),
                })?;
                self.send(Command::SetCrossfader(xf_for(cur.deck)))?;
                self.send(Command::Play(cur.deck.id()))?;
                let mut am = lock(&self.automix);
                am.current = Some(cur);
                am.transitions_seen = self.status.transitions_done();
                Ok(true)
            }
            Err(e) => {
                lock(&self.automix).say(format!("could not resume the last track: {e}"));
                Ok(false)
            }
        }
    }
}
