//! The engine: two decks and the mixer behind one `process` call.
//!
//! [`Engine`] lives on the audio thread (or in the offline renderer). [`EngineHandle`] lives on a
//! control thread and talks to it through a lock-free command queue; the engine reports back
//! through atomics in [`EngineStatus`]. Tracks the engine no longer needs are handed back
//! through a second queue so their memory is freed on the control thread, never in the
//! audio callback.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use rtrb::{Consumer, Producer, RingBuffer};

use crate::deck::{Deck, LoadedTrack, HOT_CUES};
use crate::eq::Band;
use crate::mixer::Mixer;
use crate::track::TrackBuffer;

/// Frames processed per internal block; output buffers of any size are split into these.
pub const MAX_BLOCK: usize = 1024;
const COMMAND_QUEUE: usize = 1024;
const GARBAGE_QUEUE: usize = 64;

/// How Automix blends one track into the next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionStyle {
    /// Equal-power crossfade.
    Smooth,
    /// Crossfade, swapping the bass of the two tracks half way.
    BassSwap,
    /// Instant switch (a 5 ms ramp avoids a click).
    Cut,
    /// The outgoing track stops into an echo that fades out; the new one starts at once.
    EchoOut,
}

impl TransitionStyle {
    pub const ALL: [TransitionStyle; 4] = [Self::Smooth, Self::BassSwap, Self::Cut, Self::EchoOut];
}

#[derive(Debug, Clone, Copy)]
struct Transition {
    from: DeckId,
    to: DeckId,
    style: TransitionStyle,
    /// Length in output frames.
    len: u64,
    elapsed: u64,
    /// Echo-Out: how long the dry signal takes to fade, in output frames.
    dry_fade: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeckId {
    A = 0,
    B = 1,
}

impl DeckId {
    pub const BOTH: [DeckId; 2] = [DeckId::A, DeckId::B];
}

#[derive(Debug)]
pub enum Command {
    Load {
        deck: DeckId,
        track: LoadedTrack,
    },
    Unload(DeckId),
    Play(DeckId),
    Pause(DeckId),
    /// Position in track frames.
    Seek {
        deck: DeckId,
        frame: f64,
    },
    SetHotCue {
        deck: DeckId,
        slot: usize,
    },
    JumpHotCue {
        deck: DeckId,
        slot: usize,
    },
    ClearHotCue {
        deck: DeckId,
        slot: usize,
    },
    /// Restores a saved hot cue (track frames) after loading a track.
    SetHotCueAt {
        deck: DeckId,
        slot: usize,
        frame: f64,
    },
    /// Pitch as a fraction (+0.08 = 8 % faster), clamped to the deck's range.
    SetPitch {
        deck: DeckId,
        pitch: f64,
    },
    /// 0.08, 0.16 or 0.50.
    SetPitchRange {
        deck: DeckId,
        range: f64,
    },
    /// Temporary nudge, ±0.10 at most; send 0 to release.
    SetBend {
        deck: DeckId,
        bend: f64,
    },
    SetKeyLock {
        deck: DeckId,
        on: bool,
    },
    ScratchStart(DeckId),
    /// Move the record by this many track frames (negative = backwards).
    ScratchMove {
        deck: DeckId,
        frames: f64,
    },
    ScratchEnd(DeckId),
    SetTrimDb {
        deck: DeckId,
        db: f32,
    },
    SetEqDb {
        deck: DeckId,
        band: Band,
        db: f32,
    },
    SetKill {
        deck: DeckId,
        band: Band,
        kill: bool,
    },
    SetFader {
        deck: DeckId,
        position: f32,
    },
    /// −1 (low-pass) … 0 (off) … +1 (high-pass).
    SetFilter {
        deck: DeckId,
        value: f32,
    },
    CuePress(DeckId),
    CueRelease(DeckId),
    CuePlay(DeckId),
    SetMainCueAt {
        deck: DeckId,
        frame: f64,
    },
    /// Semitones, −12 … +12.
    SetKeyShift {
        deck: DeckId,
        semitones: f64,
    },
    LoopIn(DeckId),
    LoopOut(DeckId),
    /// Loop of this many track frames from the current position.
    AutoLoop {
        deck: DeckId,
        frames: f64,
    },
    LoopResize {
        deck: DeckId,
        factor: f64,
    },
    LoopExit(DeckId),
    LoopReenter(DeckId),
    SetCrossfader(f32),
    SetMasterDb(f32),
    /// Starts an Automix transition from one deck to the other (the "to" deck should
    /// already be playing). `echo_seconds` is the Echo-Out delay (one beat).
    StartTransition {
        from: DeckId,
        to: DeckId,
        style: TransitionStyle,
        seconds: f64,
        echo_seconds: f64,
    },
    /// Stops a running transition where it is.
    CancelTransition,
    /// DUCK on / off with the given depth in dB.
    SetDuck {
        on: bool,
        depth_db: f32,
    },
    /// DUCK ramp times in seconds.
    ConfigureDuck {
        depth_db: f32,
        attack_seconds: f64,
        release_seconds: f64,
    },
    SetLimiterCeilingDb(f32),
}

/// What a deck is doing, readable from any thread.
#[derive(Debug, Default)]
pub struct DeckStatus {
    position_bits: AtomicU64,
    loaded: AtomicBool,
    playing: AtomicBool,
    ended: AtomicBool,
    cues: [AtomicU64; HOT_CUES],
    tempo_bits: AtomicU64,
    pitch_bits: AtomicU64,
    pitch_range_bits: AtomicU64,
    key_lock: AtomicBool,
    scratching: AtomicBool,
    main_cue_bits: AtomicU64,
    key_shift_bits: AtomicU64,
    loop_in_bits: AtomicU64,
    loop_out_bits: AtomicU64,
    loop_active: AtomicBool,
}

impl DeckStatus {
    /// Position in track frames.
    pub fn position(&self) -> f64 {
        f64::from_bits(self.position_bits.load(Ordering::Relaxed))
    }
    pub fn is_loaded(&self) -> bool {
        self.loaded.load(Ordering::Relaxed)
    }
    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }
    pub fn has_ended(&self) -> bool {
        self.ended.load(Ordering::Relaxed)
    }
    /// Speed relative to normal (1.0 = original tempo).
    pub fn tempo(&self) -> f64 {
        f64::from_bits(self.tempo_bits.load(Ordering::Relaxed))
    }
    pub fn pitch(&self) -> f64 {
        f64::from_bits(self.pitch_bits.load(Ordering::Relaxed))
    }
    pub fn pitch_range(&self) -> f64 {
        f64::from_bits(self.pitch_range_bits.load(Ordering::Relaxed))
    }
    pub fn key_lock(&self) -> bool {
        self.key_lock.load(Ordering::Relaxed)
    }
    pub fn is_scratching(&self) -> bool {
        self.scratching.load(Ordering::Relaxed)
    }
    pub fn main_cue(&self) -> f64 {
        f64::from_bits(self.main_cue_bits.load(Ordering::Relaxed))
    }
    pub fn key_shift(&self) -> f64 {
        f64::from_bits(self.key_shift_bits.load(Ordering::Relaxed))
    }
    /// (IN, OUT, active) in track frames.
    pub fn loop_state(&self) -> (Option<f64>, Option<f64>, bool) {
        let get = |a: &AtomicU64| {
            let v = f64::from_bits(a.load(Ordering::Relaxed));
            (!v.is_nan()).then_some(v)
        };
        (
            get(&self.loop_in_bits),
            get(&self.loop_out_bits),
            self.loop_active.load(Ordering::Relaxed),
        )
    }
    pub fn hot_cue(&self, slot: usize) -> Option<f64> {
        let v = f64::from_bits(self.cues.get(slot)?.load(Ordering::Relaxed));
        (!v.is_nan()).then_some(v)
    }

    fn publish(&self, deck: &Deck) {
        self.position_bits
            .store(deck.position().to_bits(), Ordering::Relaxed);
        self.loaded.store(deck.track().is_some(), Ordering::Relaxed);
        self.playing.store(deck.is_playing(), Ordering::Relaxed);
        self.ended.store(deck.has_ended(), Ordering::Relaxed);
        self.tempo_bits
            .store(deck.tempo().to_bits(), Ordering::Relaxed);
        self.pitch_bits
            .store(deck.pitch().to_bits(), Ordering::Relaxed);
        self.pitch_range_bits
            .store(deck.pitch_range().to_bits(), Ordering::Relaxed);
        self.key_lock.store(deck.key_lock(), Ordering::Relaxed);
        self.scratching
            .store(deck.is_scratching(), Ordering::Relaxed);
        self.main_cue_bits
            .store(deck.main_cue().to_bits(), Ordering::Relaxed);
        self.key_shift_bits
            .store(deck.key_shift().to_bits(), Ordering::Relaxed);
        let (li, lo, la) = deck.loop_state();
        self.loop_in_bits
            .store(li.unwrap_or(f64::NAN).to_bits(), Ordering::Relaxed);
        self.loop_out_bits
            .store(lo.unwrap_or(f64::NAN).to_bits(), Ordering::Relaxed);
        self.loop_active.store(la, Ordering::Relaxed);
        for (slot, c) in self.cues.iter().enumerate() {
            c.store(
                deck.hot_cue(slot).unwrap_or(f64::NAN).to_bits(),
                Ordering::Relaxed,
            );
        }
    }
}

/// Level of one signal over the last audio callback (linear, 1.0 = full scale).
#[derive(Debug, Default)]
pub struct Meter {
    peak_bits: AtomicU32,
    rms_bits: AtomicU32,
}

impl Meter {
    pub fn peak(&self) -> f32 {
        f32::from_bits(self.peak_bits.load(Ordering::Relaxed))
    }
    pub fn rms(&self) -> f32 {
        f32::from_bits(self.rms_bits.load(Ordering::Relaxed))
    }
    fn store(&self, acc: &MeterAcc) {
        let rms = if acc.count == 0 {
            0.0
        } else {
            (acc.sum_sq / acc.count as f64).sqrt() as f32
        };
        self.peak_bits.store(acc.peak.to_bits(), Ordering::Relaxed);
        self.rms_bits.store(rms.to_bits(), Ordering::Relaxed);
    }
}

#[derive(Debug, Default, Clone, Copy)]
struct MeterAcc {
    peak: f32,
    sum_sq: f64,
    count: usize,
}

impl MeterAcc {
    #[inline]
    fn add(&mut self, samples: &[f32]) {
        for &s in samples {
            self.peak = self.peak.max(s.abs());
            self.sum_sq += f64::from(s) * f64::from(s);
        }
        self.count += samples.len();
    }
}

#[derive(Debug, Default)]
pub struct EngineStatus {
    decks: [DeckStatus; 2],
    sample_rate: AtomicU32,
    frames_rendered: AtomicU64,
    transition_active: AtomicBool,
    transitions_done: AtomicU64,
    crossfader_bits: AtomicU32,
    duck_db_bits: AtomicU32,
    /// Deck A (after its channel strip), deck B, master output.
    meters: [Meter; 3],
}

impl EngineStatus {
    pub fn deck(&self, deck: DeckId) -> &DeckStatus {
        &self.decks[deck as usize]
    }
    /// Output sample rate the engine currently runs at.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Relaxed)
    }
    /// Level of deck A / deck B after their channel strips (index 0 / 1) or the master (2).
    pub fn meter(&self, index: usize) -> Option<&Meter> {
        self.meters.get(index)
    }
    /// An Automix transition is running.
    pub fn transition_active(&self) -> bool {
        self.transition_active.load(Ordering::Relaxed)
    }
    /// Number of transitions that have finished (Automix waits on this).
    pub fn transitions_done(&self) -> u64 {
        self.transitions_done.load(Ordering::Relaxed)
    }
    /// Crossfader position 0 (A) … 1 (B), as set by the DJ or Automix.
    pub fn crossfader(&self) -> f32 {
        f32::from_bits(self.crossfader_bits.load(Ordering::Relaxed))
    }
    /// Current DUCK attenuation in dB (0 = none).
    pub fn duck_db(&self) -> f32 {
        f32::from_bits(self.duck_db_bits.load(Ordering::Relaxed))
    }
    /// Total output frames produced so far (also used by the output watchdog).
    pub fn frames_rendered(&self) -> u64 {
        self.frames_rendered.load(Ordering::Relaxed)
    }
}

/// Mixer settings kept outside the mixer so they survive a sample-rate change.
#[derive(Debug, Clone, Copy)]
struct MixerSettings {
    trim_db: [f32; 2],
    filter: [f32; 2],
    eq_db: [[f32; 3]; 2],
    kill: [[bool; 3]; 2],
    fader: [f32; 2],
    crossfader: f32,
    master_db: f32,
    ceiling_db: f32,
}

impl Default for MixerSettings {
    fn default() -> Self {
        Self {
            trim_db: [0.0; 2],
            filter: [0.0; 2],
            eq_db: [[0.0; 3]; 2],
            kill: [[false; 3]; 2],
            fader: [1.0; 2],
            crossfader: 0.5,
            master_db: 0.0,
            ceiling_db: crate::limiter::DEFAULT_CEILING_DB,
        }
    }
}

impl MixerSettings {
    fn apply_all(&self, m: &mut Mixer) {
        for d in 0..2 {
            let s = &mut m.strips[d];
            s.set_trim_db(self.trim_db[d]);
            s.set_fader(self.fader[d]);
            s.set_filter(self.filter[d]);
            for band in Band::ALL {
                s.set_eq_gain_db(band, self.eq_db[d][band as usize]);
                s.set_kill(band, self.kill[d][band as usize]);
            }
        }
        m.set_crossfader(self.crossfader);
        m.set_master_db(self.master_db);
        m.limiter.set_ceiling_db(self.ceiling_db);
        m.snap();
    }
}

/// The audio-thread side.
pub struct Engine {
    sample_rate: u32,
    decks: [Deck; 2],
    mixer: Mixer,
    settings: MixerSettings,
    buf_a: Vec<f32>,
    buf_b: Vec<f32>,
    transition: Option<Transition>,
    commands: Consumer<Command>,
    garbage: Producer<LoadedTrack>,
    status: Arc<EngineStatus>,
}

impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Engine")
            .field("sample_rate", &self.sample_rate)
            .finish_non_exhaustive()
    }
}

/// The control side: send commands, read status.
pub struct EngineHandle {
    commands: Producer<Command>,
    garbage: Consumer<LoadedTrack>,
    status: Arc<EngineStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineError {
    /// The engine is not consuming commands (stalled or no output running).
    QueueFull,
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::QueueFull => f.write_str("audio engine is not responding (command queue full)"),
        }
    }
}

impl std::error::Error for EngineError {}

/// Creates an engine running at `sample_rate` and the handle to control it.
pub fn new_engine(sample_rate: u32) -> (EngineHandle, Engine) {
    let (cmd_tx, cmd_rx) = RingBuffer::new(COMMAND_QUEUE);
    let (gc_tx, gc_rx) = RingBuffer::new(GARBAGE_QUEUE);
    let status = Arc::new(EngineStatus::default());
    status.sample_rate.store(sample_rate, Ordering::Relaxed);
    let settings = MixerSettings::default();
    let mut mixer = Mixer::new(sample_rate);
    settings.apply_all(&mut mixer);
    let engine = Engine {
        sample_rate,
        decks: [Deck::new(sample_rate), Deck::new(sample_rate)],
        mixer,
        settings,
        buf_a: vec![0.0; 2 * MAX_BLOCK],
        buf_b: vec![0.0; 2 * MAX_BLOCK],
        transition: None,
        commands: cmd_rx,
        garbage: gc_tx,
        status: Arc::clone(&status),
    };
    for (deck, s) in engine.decks.iter().zip(&status.decks) {
        s.publish(deck);
    }
    let handle = EngineHandle {
        commands: cmd_tx,
        garbage: gc_rx,
        status,
    };
    (handle, engine)
}

impl EngineHandle {
    pub fn send(&mut self, command: Command) -> Result<(), EngineError> {
        self.collect_garbage();
        self.commands
            .push(command)
            .map_err(|_| EngineError::QueueFull)
    }

    /// Loads a decoded (or still decoding) track on a deck, stopped at the start.
    pub fn load(&mut self, deck: DeckId, buffer: Arc<TrackBuffer>) -> Result<(), EngineError> {
        let track = LoadedTrack::new(buffer, self.status.sample_rate());
        self.send(Command::Load { deck, track })
    }

    pub fn status(&self) -> &EngineStatus {
        &self.status
    }

    pub fn status_arc(&self) -> Arc<EngineStatus> {
        Arc::clone(&self.status)
    }

    /// Frees tracks the engine has let go of. Called automatically on every `send`.
    pub fn collect_garbage(&mut self) {
        while let Ok(track) = self.garbage.pop() {
            drop(track);
        }
    }
}

impl Engine {
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn status(&self) -> &EngineStatus {
        &self.status
    }

    pub fn status_arc(&self) -> Arc<EngineStatus> {
        Arc::clone(&self.status)
    }

    /// Pass-band edge of the resampling kernel on a deck (diagnostics and tests).
    pub fn deck_kernel_cutoff(&self, deck: DeckId) -> Option<f64> {
        self.decks[deck as usize].track().map(|t| t.kernel.cutoff())
    }

    /// Switches the output sample rate (new sound card). Keeps tracks, positions, cues and all
    /// mixer settings. Allocates: call only while no output stream is running the engine.
    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        if sample_rate == self.sample_rate || sample_rate == 0 {
            return;
        }
        // Tracks still waiting in the queue were prepared for the old rate: load them first so
        // their kernels are rebuilt below.
        self.apply_commands();
        self.sample_rate = sample_rate;
        for deck in &mut self.decks {
            deck.set_out_rate(sample_rate);
        }
        self.mixer = Mixer::new(sample_rate);
        self.settings.apply_all(&mut self.mixer);
        self.status
            .sample_rate
            .store(sample_rate, Ordering::Relaxed);
    }

    /// Fills `out` (interleaved stereo) with the next block of the mix. Realtime-safe:
    /// no allocation, locks, I/O or logging.
    pub fn process(&mut self, out: &mut [f32]) {
        self.apply_commands();
        let mut acc = [MeterAcc::default(); 3];
        // During a transition, automation runs every 256 frames (≈ 5 ms).
        let chunk = if self.transition.is_some() {
            256
        } else {
            MAX_BLOCK
        };
        for block in out.chunks_mut(2 * chunk) {
            let n = block.len() & !1;
            self.automate((n / 2) as u64);
            let (a, b) = (&mut self.buf_a[..n], &mut self.buf_b[..n]);
            self.decks[0].render(a);
            self.decks[1].render(b);
            self.mixer.process(a, b, &mut block[..n]);
            block[n..].fill(0.0);
            acc[0].add(a);
            acc[1].add(b);
            acc[2].add(&block[..n]);
        }
        for (m, a) in self.status.meters.iter().zip(&acc) {
            m.store(a);
        }
        self.status
            .transition_active
            .store(self.transition.is_some(), Ordering::Relaxed);
        self.status
            .crossfader_bits
            .store(self.settings.crossfader.to_bits(), Ordering::Relaxed);
        self.status
            .duck_db_bits
            .store(self.mixer.ducker.level_db().to_bits(), Ordering::Relaxed);
        for (deck, s) in self.decks.iter().zip(&self.status.decks) {
            s.publish(deck);
        }
        self.status
            .frames_rendered
            .fetch_add((out.len() / 2) as u64, Ordering::Relaxed);
    }

    /// Moves the crossfader / EQ / echo of a running transition, and finishes it at the end.
    fn automate(&mut self, frames: u64) {
        let Some(mut t) = self.transition else {
            return;
        };
        let p = if t.len == 0 {
            1.0
        } else {
            (t.elapsed as f64 / t.len as f64).min(1.0)
        } as f32;
        let to_pos = if t.to == DeckId::A { 0.0 } else { 1.0 };
        let from_pos = 1.0 - to_pos;
        let (fi, ti) = (t.from as usize, t.to as usize);
        let xf = match t.style {
            TransitionStyle::Smooth | TransitionStyle::BassSwap => {
                from_pos + (to_pos - from_pos) * p
            }
            TransitionStyle::Cut => to_pos,
            TransitionStyle::EchoOut => 0.5,
        };
        if t.style == TransitionStyle::BassSwap {
            let user = |d: usize| self.settings.kill[d][Band::Low as usize];
            let (uf, ut) = (user(fi), user(ti));
            self.mixer.strips[ti].set_kill(Band::Low, ut || p < 0.5);
            self.mixer.strips[fi].set_kill(Band::Low, uf || p >= 0.5);
        }
        if t.style == TransitionStyle::EchoOut {
            let fading = t.elapsed < t.dry_fade;
            self.mixer.strips[fi]
                .echo
                .set_send(if fading { 1.0 } else { 0.0 });
            self.mixer.strips[fi].set_dry(if fading {
                1.0 - t.elapsed as f32 / t.dry_fade.max(1) as f32
            } else {
                0.0
            });
        }
        self.mixer.set_crossfader(xf);
        self.settings.crossfader = xf;
        t.elapsed += frames;
        if p >= 1.0 {
            self.finish_transition(t);
        } else {
            self.transition = Some(t);
        }
    }

    fn finish_transition(&mut self, t: Transition) {
        let (fi, ti) = (t.from as usize, t.to as usize);
        self.decks[fi].pause();
        let s = &mut self.mixer.strips[fi];
        s.set_dry(1.0);
        s.echo.clear();
        s.set_kill(Band::Low, self.settings.kill[fi][Band::Low as usize]);
        self.mixer.strips[ti].set_kill(Band::Low, self.settings.kill[ti][Band::Low as usize]);
        let to_pos = if t.to == DeckId::A { 0.0 } else { 1.0 };
        self.mixer.set_crossfader(to_pos);
        self.settings.crossfader = to_pos;
        self.transition = None;
        self.status.transitions_done.fetch_add(1, Ordering::Relaxed);
    }

    fn apply_commands(&mut self) {
        while let Ok(cmd) = self.commands.pop() {
            self.apply(cmd);
        }
    }

    fn retire(&mut self, old: Option<LoadedTrack>) {
        if let Some(track) = old {
            if let Err(rtrb::PushError::Full(track)) = self.garbage.push(track) {
                // The control thread has stopped collecting; freeing ~100 MB here would stall
                // the audio thread, so the memory is deliberately leaked instead.
                std::mem::forget(track);
            }
        }
    }

    fn apply(&mut self, cmd: Command) {
        let s = &mut self.settings;
        match cmd {
            Command::Load { deck, track } => {
                let old = self.decks[deck as usize].load(track);
                self.retire(old);
            }
            Command::Unload(deck) => {
                let old = self.decks[deck as usize].unload();
                self.retire(old);
            }
            Command::Play(deck) => self.decks[deck as usize].play(),
            Command::Pause(deck) => self.decks[deck as usize].pause(),
            Command::Seek { deck, frame } => self.decks[deck as usize].seek(frame),
            Command::SetHotCue { deck, slot } => self.decks[deck as usize].set_hot_cue(slot),
            Command::JumpHotCue { deck, slot } => {
                self.decks[deck as usize].jump_to_hot_cue(slot);
            }
            Command::ClearHotCue { deck, slot } => self.decks[deck as usize].clear_hot_cue(slot),
            Command::SetHotCueAt { deck, slot, frame } => {
                self.decks[deck as usize].set_hot_cue_at(slot, frame);
            }
            Command::SetPitch { deck, pitch } => self.decks[deck as usize].set_pitch(pitch),
            Command::SetPitchRange { deck, range } => {
                self.decks[deck as usize].set_pitch_range(range);
            }
            Command::SetBend { deck, bend } => self.decks[deck as usize].set_bend(bend),
            Command::SetKeyLock { deck, on } => self.decks[deck as usize].set_key_lock(on),
            Command::ScratchStart(deck) => self.decks[deck as usize].scratch_start(),
            Command::ScratchMove { deck, frames } => {
                self.decks[deck as usize].scratch_move(frames);
            }
            Command::ScratchEnd(deck) => self.decks[deck as usize].scratch_end(),
            Command::SetTrimDb { deck, db } => {
                s.trim_db[deck as usize] = db;
                self.mixer.strips[deck as usize].set_trim_db(db);
            }
            Command::SetEqDb { deck, band, db } => {
                s.eq_db[deck as usize][band as usize] = db;
                self.mixer.strips[deck as usize].set_eq_gain_db(band, db);
            }
            Command::SetKill { deck, band, kill } => {
                s.kill[deck as usize][band as usize] = kill;
                self.mixer.strips[deck as usize].set_kill(band, kill);
            }
            Command::SetFader { deck, position } => {
                s.fader[deck as usize] = position;
                self.mixer.strips[deck as usize].set_fader(position);
            }
            Command::SetFilter { deck, value } => {
                s.filter[deck as usize] = value;
                self.mixer.strips[deck as usize].set_filter(value);
            }
            Command::CuePress(deck) => self.decks[deck as usize].cue_press(),
            Command::CueRelease(deck) => self.decks[deck as usize].cue_release(),
            Command::CuePlay(deck) => self.decks[deck as usize].cue_play(),
            Command::SetMainCueAt { deck, frame } => {
                self.decks[deck as usize].set_main_cue_at(frame);
            }
            Command::SetKeyShift { deck, semitones } => {
                self.decks[deck as usize].set_key_shift(semitones);
            }
            Command::LoopIn(deck) => self.decks[deck as usize].loop_set_in(),
            Command::LoopOut(deck) => self.decks[deck as usize].loop_set_out(),
            Command::AutoLoop { deck, frames } => self.decks[deck as usize].auto_loop(frames),
            Command::LoopResize { deck, factor } => {
                self.decks[deck as usize].loop_resize(factor);
            }
            Command::LoopExit(deck) => self.decks[deck as usize].loop_exit(),
            Command::LoopReenter(deck) => self.decks[deck as usize].loop_reenter(),
            Command::SetCrossfader(p) => {
                s.crossfader = p;
                self.mixer.set_crossfader(p);
            }
            Command::StartTransition {
                from,
                to,
                style,
                seconds,
                echo_seconds,
            } => {
                if let Some(old) = self.transition.take() {
                    self.finish_transition(old);
                }
                if from != to {
                    let rate = f64::from(self.sample_rate);
                    let len = if style == TransitionStyle::Cut {
                        0
                    } else {
                        (seconds.clamp(0.0, 60.0) * rate) as u64
                    };
                    let fi = from as usize;
                    if style == TransitionStyle::EchoOut {
                        let delay = (echo_seconds.clamp(0.05, 1.9) * rate) as usize;
                        self.mixer.strips[fi].echo.set_delay(delay);
                        self.mixer.strips[fi].echo.set_feedback(0.55);
                    }
                    self.transition = Some(Transition {
                        from,
                        to,
                        style,
                        len,
                        elapsed: 0,
                        dry_fade: ((0.3 * rate) as u64).min(len / 3).max(1),
                    });
                }
            }
            Command::CancelTransition => {
                if let Some(t) = self.transition.take() {
                    let fi = t.from as usize;
                    self.mixer.strips[fi].set_dry(1.0);
                    self.mixer.strips[fi].echo.set_send(0.0);
                    for d in 0..2 {
                        self.mixer.strips[d]
                            .set_kill(Band::Low, self.settings.kill[d][Band::Low as usize]);
                    }
                }
            }
            Command::SetDuck { on, depth_db } => self.mixer.ducker.set(on, depth_db),
            Command::ConfigureDuck {
                depth_db,
                attack_seconds,
                release_seconds,
            } => self
                .mixer
                .ducker
                .configure(depth_db, attack_seconds, release_seconds),
            Command::SetMasterDb(db) => {
                s.master_db = db;
                self.mixer.set_master_db(db);
            }
            Command::SetLimiterCeilingDb(db) => {
                s.ceiling_db = db;
                self.mixer.limiter.set_ceiling_db(db);
            }
        }
    }
}
