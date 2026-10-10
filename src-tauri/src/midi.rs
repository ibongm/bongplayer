//! Pioneer DDJ-400 over MIDI (midir): reading the controller, applying it to the decks and
//! mixer, lighting its LEDs, and finding it again when it is plugged in.
//!
//! Message numbers follow Pioneer's DDJ-400 MIDI layout (deck 1 = MIDI channel 1, deck 2 =
//! channel 2, mixer = channel 7, pads = channels 8–11). 14-bit controls send the high byte
//! first, then the low byte on CC + 0x20; a value is applied when the low byte arrives.

use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::commands::{run_engine_command, BandName, UiCommand};
use crate::lock::Action;
use crate::state::{lock, AppState, DeckName};

/// Port names containing this are taken as the DDJ-400.
pub const DEVICE_MATCH: &str = "DDJ-400";
/// Event the screen listens to for controller changes.
pub const MIDI_EVENT: &str = "midi";
/// Settings key: "0" switches the controller off (on by default).
pub const MIDI_ENABLED_KEY: &str = "midi.enabled";
/// Jog: 720 ticks per turn at 33⅓ rpm (1.8 s per turn) → seconds of audio per tick.
pub const SCRATCH_SECONDS_PER_TICK: f64 = 1.8 / 720.0;
/// Pitch bend per jog tick (the ring), and its limit.
const BEND_PER_TICK: f64 = 0.004;
const BEND_MAX: f64 = 0.10;
/// Bend is released when the ring has not moved for this long.
const BEND_RELEASE: Duration = Duration::from_millis(100);
/// Seconds moved per tick with SHIFT + jog (search).
const SEARCH_SECONDS_PER_TICK: f64 = 0.15;
/// Seconds moved per ring tick while the deck is paused (fine positioning).
const NUDGE_SECONDS_PER_TICK: f64 = 0.01;
/// Beat-loop pads 1–8.
pub const BEAT_LOOPS: [f64; 8] = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button {
    Play,
    Cue,
    Sync,
    Shift,
    JogTouch,
    HeadphoneCue,
    LoopIn,
    LoopOut,
    ReloopExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    Tempo,
    Trim,
    Eq(BandName),
    Fader,
    Filter,
    Crossfader,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JogMode {
    /// Top of the platter while touched (vinyl mode).
    Scratch,
    /// The ring, or the top without vinyl mode: pitch bend.
    Bend,
    /// SHIFT + jog: fast search.
    Search,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PadMode {
    HotCue,
    Sampler,
    BeatLoop,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Button {
        deck: DeckName,
        button: Button,
        pressed: bool,
    },
    /// A 14-bit control. `raw` is 0 … 16383; `value` the same as 0 … 1.
    Control {
        deck: Option<DeckName>,
        control: Control,
        raw: u16,
        value: f32,
    },
    Jog {
        deck: DeckName,
        mode: JogMode,
        ticks: i32,
    },
    Pad {
        deck: DeckName,
        mode: PadMode,
        index: usize,
        shift: bool,
        pressed: bool,
    },
    Load(DeckName),
    Browse(i32),
}

/// Turns raw MIDI messages into events. Keeps the high bytes of 14-bit controls.
#[derive(Debug, Default)]
pub struct Decoder {
    msb: [[u8; 32]; 16],
}

fn deck_of(channel: u8) -> Option<DeckName> {
    match channel {
        0 => Some(DeckName::A),
        1 => Some(DeckName::B),
        _ => None,
    }
}

impl Decoder {
    pub fn decode(&mut self, msg: &[u8]) -> Option<Event> {
        let [status, d1, d2] = *msg.get(..3)? else {
            return None;
        };
        let kind = status & 0xF0;
        let ch = status & 0x0F;
        match kind {
            0x80 | 0x90 => self.note(ch, d1, kind == 0x90 && d2 > 0),
            0xB0 => self.cc(ch, d1, d2),
            _ => None,
        }
    }

    fn note(&mut self, ch: u8, note: u8, pressed: bool) -> Option<Event> {
        // Pads: channel 8 / 9 = left (normal / SHIFT), 10 / 11 = right.
        if (7..=10).contains(&ch) {
            let deck = if ch <= 8 { DeckName::A } else { DeckName::B };
            let shift = ch == 8 || ch == 10;
            let (mode, index) = match note {
                0x00..=0x07 => (PadMode::HotCue, note),
                0x30..=0x37 => (PadMode::Sampler, note - 0x30),
                0x60..=0x67 => (PadMode::BeatLoop, note - 0x60),
                _ => return None,
            };
            return Some(Event::Pad {
                deck,
                mode,
                index: usize::from(index),
                shift,
                pressed,
            });
        }
        if ch == 6 {
            return match note {
                0x46 if pressed => Some(Event::Load(DeckName::A)),
                0x47 if pressed => Some(Event::Load(DeckName::B)),
                _ => None,
            };
        }
        let deck = deck_of(ch)?;
        let button = match note {
            0x0B => Button::Play,
            0x0C => Button::Cue,
            0x58 => Button::Sync,
            0x3F => Button::Shift,
            0x36 => Button::JogTouch,
            0x54 => Button::HeadphoneCue,
            0x10 => Button::LoopIn,
            0x11 => Button::LoopOut,
            0x4D => Button::ReloopExit,
            _ => return None,
        };
        Some(Event::Button {
            deck,
            button,
            pressed,
        })
    }

    fn cc(&mut self, ch: u8, cc: u8, value: u8) -> Option<Event> {
        if let Some(deck) = deck_of(ch) {
            let mode = match cc {
                0x22 => Some(JogMode::Scratch),
                0x21 | 0x23 => Some(JogMode::Bend),
                0x29 => Some(JogMode::Search),
                _ => None,
            };
            if let Some(mode) = mode {
                return Some(Event::Jog {
                    deck,
                    mode,
                    ticks: i32::from(value) - 64,
                });
            }
        }
        if ch == 6 && cc == 0x40 {
            let steps = if value > 64 {
                i32::from(value) - 128
            } else {
                i32::from(value)
            };
            return Some(Event::Browse(steps));
        }
        if cc < 0x20 {
            self.msb[usize::from(ch)][usize::from(cc)] = value;
            return None;
        }
        let pair = cc - 0x20;
        let (deck, control) = match (ch, pair) {
            (0 | 1, 0x00) => (deck_of(ch), Control::Tempo),
            (0 | 1, 0x04) => (deck_of(ch), Control::Trim),
            (0 | 1, 0x07) => (deck_of(ch), Control::Eq(BandName::High)),
            (0 | 1, 0x0B) => (deck_of(ch), Control::Eq(BandName::Mid)),
            (0 | 1, 0x0F) => (deck_of(ch), Control::Eq(BandName::Low)),
            (0 | 1, 0x13) => (deck_of(ch), Control::Fader),
            (6, 0x17) => (Some(DeckName::A), Control::Filter),
            (6, 0x18) => (Some(DeckName::B), Control::Filter),
            (6, 0x1F) => (None, Control::Crossfader),
            _ => return None,
        };
        let raw = (u16::from(self.msb[usize::from(ch)][usize::from(pair)]) << 7) | u16::from(value);
        Some(Event::Control {
            deck,
            control,
            raw,
            value: f32::from(raw) / 16383.0,
        })
    }
}

/// Knob position (0 … 1, centre 0.5) → dB with the given range below and above 0 dB.
pub fn knob_db(value: f32, below: f32, above: f32) -> f32 {
    let v = value.clamp(0.0, 1.0);
    if v < 0.5 {
        -below * (1.0 - 2.0 * v)
    } else {
        above * (2.0 * v - 1.0)
    }
}

/// Tempo fader (14-bit) → pitch fraction within `range`; low raw values are faster.
pub fn tempo_pitch(raw: u16, range: f64) -> f64 {
    let frac = (1.0 - f64::from(raw) / 8192.0).clamp(-1.0, 1.0);
    // A small dead zone keeps the centre detent at exactly 0 %.
    if frac.abs() < 0.002 {
        0.0
    } else {
        frac * range
    }
}

/// Something the screen should follow (knobs moved on the controller, load / browse).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiEvent {
    /// A mixer control moved: `key` is the screen's name for it (trim, high, mid, low, filter,
    /// fader, crossfader).
    Mixer {
        deck: Option<DeckName>,
        key: &'static str,
        value: f32,
    },
    /// LOAD pressed: load the selected track of the table to this deck.
    Load { deck: DeckName },
    /// Browse knob turned.
    Browse { steps: i32 },
    /// A controller action was refused (e.g. LOCK is on).
    Notice { text: String },
}

/// What the controller is doing (SHIFT held, jog touched, bend running).
#[derive(Debug, Default)]
pub struct Dispatcher {
    shift: [bool; 2],
    touched: [bool; 2],
    bend_at: [Option<Instant>; 2],
    last_notice: Option<Instant>,
}

impl Dispatcher {
    /// Applies one event. Refusals (LOCK) come back as a notice at most once a second.
    pub fn handle(
        &mut self,
        state: &AppState,
        event: Event,
        now: Instant,
        emit: &mut dyn FnMut(UiEvent),
    ) {
        if let Err(e) = self.apply(state, event, now, emit) {
            let quiet = self
                .last_notice
                .is_some_and(|t| now.duration_since(t) < Duration::from_secs(1));
            if !quiet {
                self.last_notice = Some(now);
                emit(UiEvent::Notice {
                    text: format!("DDJ-400: {e}"),
                });
            }
        }
    }

    /// Releases a pitch bend once the ring stops. Call every few milliseconds.
    pub fn tick(&mut self, state: &AppState, now: Instant) {
        for deck in [DeckName::A, DeckName::B] {
            let i = deck.index();
            if self.bend_at[i].is_some_and(|t| now.duration_since(t) >= BEND_RELEASE) {
                self.bend_at[i] = None;
                let _ = run_engine_command(state, UiCommand::Bend { deck, bend: 0.0 });
            }
        }
    }

    fn position(state: &AppState, deck: DeckName) -> f64 {
        let rate = state.file_rate(deck).unwrap_or(44_100).max(1);
        state.status.deck(deck.id()).position() / f64::from(rate)
    }

    fn apply(
        &mut self,
        state: &AppState,
        event: Event,
        now: Instant,
        emit: &mut dyn FnMut(UiEvent),
    ) -> Result<(), String> {
        let run = |c: UiCommand| run_engine_command(state, c);
        match event {
            Event::Button {
                deck,
                button,
                pressed,
            } => {
                let i = deck.index();
                match button {
                    Button::Shift => self.shift[i] = pressed,
                    Button::JogTouch => {
                        self.touched[i] = pressed;
                        if pressed {
                            run(UiCommand::ScratchStart { deck })?;
                        } else {
                            run(UiCommand::ScratchEnd { deck })?;
                        }
                    }
                    Button::Cue if self.shift[i] && pressed => {
                        run(UiCommand::Seek { deck, seconds: 0.0 })?;
                    }
                    Button::Cue if pressed => run(UiCommand::CuePress { deck })?,
                    Button::Cue => run(UiCommand::CueRelease { deck })?,
                    _ if !pressed => {}
                    Button::Play => run(UiCommand::TogglePlay { deck })?,
                    Button::Sync => run(UiCommand::Sync { deck })?,
                    Button::HeadphoneCue => {
                        let on = !state.status.cue()[i];
                        run(UiCommand::Cue { deck, on })?;
                    }
                    Button::LoopIn => run(UiCommand::LoopIn { deck })?,
                    Button::LoopOut => run(UiCommand::LoopOut { deck })?,
                    Button::ReloopExit => {
                        let (_, _, active) = state.status.deck(deck.id()).loop_state();
                        run(if active {
                            UiCommand::LoopExit { deck }
                        } else {
                            UiCommand::LoopReenter { deck }
                        })?;
                    }
                }
            }
            Event::Control {
                deck,
                control,
                raw,
                value,
            } => {
                let mixer = |key: &'static str, v: f32, emit: &mut dyn FnMut(UiEvent)| {
                    emit(UiEvent::Mixer {
                        deck,
                        key,
                        value: v,
                    });
                };
                match (control, deck) {
                    (Control::Tempo, Some(deck)) => {
                        let range = state.status.deck(deck.id()).pitch_range();
                        run(UiCommand::Pitch {
                            deck,
                            pitch: tempo_pitch(raw, range),
                        })?;
                    }
                    (Control::Trim, Some(deck)) => {
                        let db = knob_db(value, 24.0, 12.0);
                        run(UiCommand::Trim { deck, db })?;
                        mixer("trim", db, emit);
                    }
                    (Control::Eq(band), Some(deck)) => {
                        let db = knob_db(value, 24.0, 6.0);
                        run(UiCommand::Eq { deck, band, db })?;
                        let key = match band {
                            BandName::High => "high",
                            BandName::Mid => "mid",
                            BandName::Low => "low",
                        };
                        mixer(key, db, emit);
                    }
                    (Control::Fader, Some(deck)) => {
                        run(UiCommand::Fader {
                            deck,
                            position: value,
                        })?;
                        mixer("fader", value, emit);
                    }
                    (Control::Filter, Some(deck)) => {
                        let v = 2.0 * value - 1.0;
                        let v = if v.abs() < 0.02 { 0.0 } else { v };
                        run(UiCommand::Filter { deck, value: v })?;
                        mixer("filter", v, emit);
                    }
                    (Control::Crossfader, _) => {
                        run(UiCommand::Crossfader { position: value })?;
                        mixer("crossfader", value, emit);
                    }
                    _ => {}
                }
            }
            Event::Jog { deck, mode, ticks } => {
                let i = deck.index();
                let mode = if self.shift[i] { JogMode::Search } else { mode };
                match mode {
                    JogMode::Scratch if self.touched[i] => run(UiCommand::ScratchMove {
                        deck,
                        seconds: f64::from(ticks) * SCRATCH_SECONDS_PER_TICK,
                    })?,
                    JogMode::Search => run(UiCommand::Seek {
                        deck,
                        seconds: (Self::position(state, deck)
                            + f64::from(ticks) * SEARCH_SECONDS_PER_TICK)
                            .max(0.0),
                    })?,
                    _ if state.status.deck(deck.id()).is_playing() => {
                        let bend = (f64::from(ticks) * BEND_PER_TICK).clamp(-BEND_MAX, BEND_MAX);
                        run(UiCommand::Bend { deck, bend })?;
                        self.bend_at[i] = Some(now);
                    }
                    _ => run(UiCommand::Seek {
                        deck,
                        seconds: (Self::position(state, deck)
                            + f64::from(ticks) * NUDGE_SECONDS_PER_TICK)
                            .max(0.0),
                    })?,
                }
            }
            Event::Pad {
                deck,
                mode,
                index,
                shift,
                pressed,
            } => {
                if !pressed {
                    return Ok(());
                }
                match mode {
                    PadMode::HotCue if shift => {
                        state.lock_check(Action::Music)?;
                        state.clear_hot_cue(deck, index)?;
                    }
                    PadMode::HotCue => {
                        if state.status.deck(deck.id()).hot_cue(index).is_some() {
                            run(UiCommand::JumpHotCue { deck, slot: index })?;
                        } else {
                            state.lock_check(Action::Music)?;
                            state.set_hot_cue(deck, index)?;
                        }
                    }
                    PadMode::Sampler if shift => state.sampler_stop(Some(index))?,
                    PadMode::Sampler => state.sampler_trigger(index)?,
                    PadMode::BeatLoop => run(UiCommand::AutoLoop {
                        deck,
                        beats: BEAT_LOOPS[index.min(7)],
                    })?,
                }
            }
            Event::Load(deck) => emit(UiEvent::Load { deck }),
            Event::Browse(steps) => emit(UiEvent::Browse { steps }),
        }
        Ok(())
    }
}

// ----- LEDs -----

/// What the LEDs show.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LedState {
    pub loaded: [bool; 2],
    pub playing: [bool; 2],
    pub headphone: [bool; 2],
    pub loop_active: [bool; 2],
    pub hot_cues: [[bool; 8]; 2],
    /// Sampler pads with a sound.
    pub pads_loaded: [bool; 8],
    pub pads_playing: u8,
    /// Deck levels after the channel strip (linear peak).
    pub level: [f32; 2],
}

impl LedState {
    pub fn read(state: &AppState) -> Self {
        let st = &state.status;
        let mut l = Self::default();
        for deck in [DeckName::A, DeckName::B] {
            let i = deck.index();
            let d = st.deck(deck.id());
            l.loaded[i] = d.is_loaded();
            l.playing[i] = d.is_playing();
            l.loop_active[i] = d.loop_state().2;
            for (slot, lit) in l.hot_cues[i].iter_mut().enumerate() {
                *lit = d.hot_cue(slot).is_some();
            }
            l.level[i] = st.meter(i).map_or(0.0, |m| m.peak());
        }
        l.headphone = st.cue();
        for (p, info) in state.sampler_pads().iter().enumerate().take(8) {
            l.pads_loaded[p] = info.seconds.is_some();
        }
        l.pads_playing = st.pads_playing();
        l
    }
}

/// Level meter value 0 … 127 (−48 dB … 0 dB).
pub fn vu_value(peak: f32) -> u8 {
    if peak <= 0.0 {
        return 0;
    }
    let db = 20.0 * peak.log10();
    (((db + 48.0) / 48.0).clamp(0.0, 1.0) * 127.0).round() as u8
}

/// Every LED message for a state: [status, number, value].
pub fn led_messages(l: &LedState) -> Vec<[u8; 3]> {
    let on = |b: bool| if b { 0x7F } else { 0x00 };
    let mut out = Vec::with_capacity(64);
    for i in 0..2 {
        let ch = i as u8;
        out.push([0x90 | ch, 0x0B, on(l.playing[i])]);
        out.push([0x90 | ch, 0x0C, on(l.loaded[i] && !l.playing[i])]);
        out.push([0x90 | ch, 0x54, on(l.headphone[i])]);
        for note in [0x10, 0x11, 0x4D] {
            out.push([0x90 | ch, note, on(l.loop_active[i])]);
        }
        let pads = if i == 0 { 0x97 } else { 0x99 };
        for slot in 0..8u8 {
            out.push([pads, slot, on(l.hot_cues[i][usize::from(slot)])]);
            let lit = l.pads_loaded[usize::from(slot)] || l.pads_playing & (1 << slot) != 0;
            out.push([pads, 0x30 + slot, on(lit)]);
        }
        out.push([0xB0 | ch, 0x02, vu_value(l.level[i])]);
    }
    out
}

/// Sends only LEDs that changed since last time.
#[derive(Debug, Default)]
pub struct LedCache {
    sent: std::collections::HashMap<(u8, u8), u8>,
}

impl LedCache {
    pub fn changes(&mut self, messages: Vec<[u8; 3]>) -> Vec<[u8; 3]> {
        messages
            .into_iter()
            .filter(|m| self.sent.insert((m[0], m[1]), m[2]) != Some(m[2]))
            .collect()
    }

    pub fn clear(&mut self) {
        self.sent.clear();
    }
}

// ----- the connection -----

/// What Settings → MIDI shows.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiInfo {
    pub enabled: bool,
    /// Name of the connected DDJ-400 input, if any.
    pub device: Option<String>,
    /// Whether its LEDs can be driven (output port found).
    pub leds: bool,
    /// All MIDI inputs Windows lists.
    pub inputs: Vec<String>,
    pub error: Option<String>,
}

struct Connection {
    name: String,
    _input: midir::MidiInputConnection<()>,
    output: Option<midir::MidiOutputConnection>,
}

fn input_names() -> Result<Vec<String>, String> {
    let input = midir::MidiInput::new("BongPlayer scan").map_err(|e| e.to_string())?;
    Ok(input
        .ports()
        .iter()
        .filter_map(|p| input.port_name(p).ok())
        .collect())
}

fn connect(tx: mpsc::Sender<Vec<u8>>) -> Result<Option<Connection>, String> {
    let input = midir::MidiInput::new("BongPlayer").map_err(|e| e.to_string())?;
    let Some((port, name)) = input.ports().into_iter().find_map(|p| {
        let name = input.port_name(&p).ok()?;
        name.contains(DEVICE_MATCH).then_some((p, name))
    }) else {
        return Ok(None);
    };
    let conn = input
        .connect(
            &port,
            "bongplayer-in",
            move |_, msg, _| {
                let _ = tx.send(msg.to_vec());
            },
            (),
        )
        .map_err(|e| format!("cannot open {name}: {e}"))?;
    let output = midir::MidiOutput::new("BongPlayer").ok().and_then(|out| {
        let port = out
            .ports()
            .into_iter()
            .find(|p| out.port_name(p).is_ok_and(|n| n.contains(DEVICE_MATCH)))?;
        out.connect(&port, "bongplayer-out").ok()
    });
    Ok(Some(Connection {
        name,
        _input: conn,
        output,
    }))
}

impl AppState {
    pub fn midi_enabled(&self) -> bool {
        lock(&self.library)
            .setting(MIDI_ENABLED_KEY)
            .ok()
            .flatten()
            .as_deref()
            != Some("0")
    }

    pub fn midi_info(&self) -> MidiInfo {
        lock(&self.midi).clone()
    }
}

/// Runs the controller: connects when a DDJ-400 appears, applies its messages, drives its
/// LEDs, and lets go when it disappears. `emit` sends screen updates.
pub fn start(state: Arc<AppState>, emit: impl FnMut(UiEvent) + Send + 'static) {
    let spawned = std::thread::Builder::new()
        .name("bong-midi".into())
        .spawn(move || run(&state, emit));
    if let Err(e) = spawned {
        eprintln!("BongPlayer: the controller support could not start: {e}");
    }
}

fn run(state: &AppState, mut emit: impl FnMut(UiEvent)) {
    let (tx, rx): (mpsc::Sender<Vec<u8>>, Receiver<Vec<u8>>) = mpsc::channel();
    let mut conn: Option<Connection> = None;
    let mut decoder = Decoder::default();
    let mut dispatcher = Dispatcher::default();
    let mut leds = LedCache::default();
    let mut last_scan: Option<Instant> = None;
    let mut last_leds = Instant::now();
    loop {
        let now = Instant::now();
        if last_scan.is_none_or(|t| now.duration_since(t) >= Duration::from_secs(2)) {
            last_scan = Some(now);
            let enabled = state.midi_enabled();
            let inputs = input_names();
            let mut info = MidiInfo {
                enabled,
                ..MidiInfo::default()
            };
            match &inputs {
                Ok(list) => info.inputs.clone_from(list),
                Err(e) => info.error = Some(e.clone()),
            }
            let present = inputs
                .as_ref()
                .is_ok_and(|l| l.iter().any(|n| n.contains(DEVICE_MATCH)));
            if conn.is_some() && (!enabled || !present) {
                // Unplugged or switched off: let go, so it can be found again.
                conn = None;
                leds.clear();
            }
            if conn.is_none() && enabled && present {
                match connect(tx.clone()) {
                    Ok(c) => {
                        conn = c;
                        decoder = Decoder::default();
                        leds.clear();
                    }
                    Err(e) => info.error = Some(e),
                }
            }
            info.device = conn.as_ref().map(|c| c.name.clone());
            info.leds = conn.as_ref().is_some_and(|c| c.output.is_some());
            *lock(&state.midi) = info;
        }
        while let Ok(msg) = rx.try_recv() {
            if conn.is_none() {
                continue;
            }
            if let Some(ev) = decoder.decode(&msg) {
                dispatcher.handle(state, ev, Instant::now(), &mut emit);
            }
        }
        dispatcher.tick(state, Instant::now());
        if now.duration_since(last_leds) >= Duration::from_millis(50) {
            last_leds = now;
            if let Some(out) = conn.as_mut().and_then(|c| c.output.as_mut()) {
                for m in leds.changes(led_messages(&LedState::read(state))) {
                    let _ = out.send(&m);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
