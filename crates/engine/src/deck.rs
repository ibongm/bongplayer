//! A deck: one loaded track, a read head, transport, hot cues, pitch, key lock and scratching.
//!
//! Positions are in frames of the *track's* sample rate, as `f64`, so cue points stay exact
//! whatever the output device runs at.
//!
//! - **Pitch** changes playback speed (and with it the musical pitch, like a turntable):
//!   `tempo = 1 + pitch + bend`. The pitch fader range is ±8, ±16 or ±50 %.
//! - **Key lock** keeps the musical pitch while the tempo changes: the read head still runs at
//!   `tempo`, then the Signalsmith pitch shifter transposes by `1 / tempo`. The shifter adds a
//!   delay; the deck reads that far *ahead* so the reported position is what you hear.
//! - **Scratch**: while the platter is held, the read head follows the hand (forward or backward)
//!   with a short glide, like a record under a finger. Key lock is bypassed while scratching.

use std::sync::Arc;

use stretch::Stretch;

use crate::resample::SincTable;
use crate::track::TrackBuffer;

pub const HOT_CUES: usize = 8;
/// Pitch fader ranges offered to the DJ.
pub const PITCH_RANGES: [f64; 3] = [0.08, 0.16, 0.50];
/// Largest temporary pitch bend (nudge).
pub const MAX_BEND: f64 = 0.10;
/// Frames processed at a time internally (key lock and pre-roll work in these blocks).
const BLOCK: usize = 512;
/// How quickly a scratched record follows the hand (time constant).
const SCRATCH_GLIDE_SECONDS: f64 = 0.006;
/// Fastest a record may be pushed by hand, in multiples of normal speed.
const MAX_SCRATCH_SPEED: f64 = 8.0;

/// A track ready to be put on a deck: audio plus the interpolation kernel for the current
/// output rate. Built off the audio thread.
#[derive(Debug, Clone)]
pub struct LoadedTrack {
    pub buffer: Arc<TrackBuffer>,
    pub kernel: Arc<SincTable>,
}

impl LoadedTrack {
    pub fn new(buffer: Arc<TrackBuffer>, out_rate: u32) -> Self {
        let kernel = Arc::new(SincTable::for_rates(buffer.sample_rate(), out_rate));
        Self { buffer, kernel }
    }
}

pub struct Deck {
    track: Option<LoadedTrack>,
    out_rate: u32,
    /// Read head in track frames. With key lock active it runs `lead` frames ahead of what is
    /// heard; [`Deck::position`] reports the audible position.
    head: f64,
    /// Track frames per output frame at 0 % pitch (file rate / output rate).
    base_step: f64,
    playing: bool,
    ended: bool,
    cues: [Option<f64>; HOT_CUES],

    pitch: f64,
    pitch_range: f64,
    bend: f64,

    key_lock: bool,
    stretch: Option<Stretch>,
    /// Key lock path in use (key lock on, playing, not scratching).
    stretch_active: bool,
    /// The shifter must be reset and filled before its output is used.
    needs_preroll: bool,
    /// How far (track frames) the read head is ahead of the audible position.
    lead: f64,
    tmp_in: Vec<f32>,
    tmp_out: Vec<f32>,

    scratching: bool,
    scratch_target: f64,
    scratch_speed: f64,
    scratch_coeff: f64,

    /// Main cue point (CUE / CUP buttons), track frames.
    main_cue: f64,
    /// CUE is held while paused: playing a preview that returns to the cue on release.
    cue_preview: bool,
    /// Transpose in semitones (KEY shift), independent of tempo.
    key_shift: f64,
    loop_in: Option<f64>,
    loop_out: Option<f64>,
    loop_active: bool,
}

impl std::fmt::Debug for Deck {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Deck")
            .field("position", &self.position())
            .field("playing", &self.playing)
            .field("tempo", &self.tempo())
            .field("key_lock", &self.key_lock)
            .finish_non_exhaustive()
    }
}

impl Deck {
    /// Allocates (pitch shifter, buffers): create off the audio thread.
    pub fn new(out_rate: u32) -> Self {
        let mut deck = Self {
            track: None,
            out_rate: out_rate.max(1),
            head: 0.0,
            base_step: 1.0,
            playing: false,
            ended: false,
            cues: [None; HOT_CUES],
            pitch: 0.0,
            pitch_range: PITCH_RANGES[0],
            bend: 0.0,
            key_lock: false,
            stretch: Stretch::new(out_rate.max(1)),
            stretch_active: false,
            needs_preroll: true,
            lead: 0.0,
            tmp_in: vec![0.0; 2 * BLOCK],
            tmp_out: vec![0.0; 2 * BLOCK],
            scratching: false,
            scratch_target: 0.0,
            scratch_speed: 0.0,
            scratch_coeff: 0.0,
            main_cue: 0.0,
            cue_preview: false,
            key_shift: 0.0,
            loop_in: None,
            loop_out: None,
            loop_active: false,
        };
        deck.update_rate_constants();
        deck
    }

    fn update_rate_constants(&mut self) {
        let tau = SCRATCH_GLIDE_SECONDS * f64::from(self.out_rate);
        self.scratch_coeff = 1.0 - (-1.0 / tau).exp();
        if let Some(t) = &self.track {
            self.base_step = f64::from(t.buffer.sample_rate()) / f64::from(self.out_rate);
        }
    }

    /// Switches to a new output rate (e.g. after the sound card changed), keeping the track,
    /// position, transport, cues, pitch and key lock. Allocates: not on the audio thread.
    pub fn set_out_rate(&mut self, out_rate: u32) {
        let audible = self.position();
        self.out_rate = out_rate.max(1);
        self.stretch = Stretch::new(self.out_rate);
        if let Some(track) = self.track.as_mut() {
            let file_rate = track.buffer.sample_rate();
            track.kernel = Arc::new(SincTable::for_rates(file_rate, self.out_rate));
        }
        self.update_rate_constants();
        self.jump_to(audible);
    }

    /// Puts a track on the deck, stopped at the start, and returns the previous one so the
    /// caller can free it off the audio thread. Hot cues are cleared (they belong to a track);
    /// pitch and key lock stay as the DJ set them.
    pub fn load(&mut self, track: LoadedTrack) -> Option<LoadedTrack> {
        self.playing = false;
        self.ended = false;
        self.scratching = false;
        self.cues = [None; HOT_CUES];
        self.main_cue = 0.0;
        self.cue_preview = false;
        self.loop_in = None;
        self.loop_out = None;
        self.loop_active = false;
        let old = self.track.replace(track);
        self.update_rate_constants();
        self.jump_to(0.0);
        old
    }

    pub fn unload(&mut self) -> Option<LoadedTrack> {
        self.playing = false;
        self.ended = false;
        self.scratching = false;
        self.jump_to(0.0);
        self.track.take()
    }

    pub fn track(&self) -> Option<&LoadedTrack> {
        self.track.as_ref()
    }

    pub fn play(&mut self) {
        if self.track.is_some() && !self.playing {
            self.playing = true;
            self.ended = false;
            let audible = self.position();
            self.jump_to(audible);
        }
    }

    pub fn pause(&mut self) {
        if self.playing {
            let audible = self.position();
            self.playing = false;
            self.jump_to(audible);
        }
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn has_ended(&self) -> bool {
        self.ended
    }

    /// Audible position in track frames.
    pub fn position(&self) -> f64 {
        if !(self.stretch_active && !self.needs_preroll) {
            return self.head;
        }
        let mut p = self.head - self.lead;
        // Just after the read head jumped back to the loop start, what is heard is still the
        // end of the loop.
        if self.loop_active {
            if let (Some(i), Some(o)) = (self.loop_in, self.loop_out) {
                if p < i && self.head >= i && o > i {
                    p += o - i;
                }
            }
        }
        p.max(0.0)
    }

    /// Moves to `frame` (track frames), clamped to the start of the track.
    pub fn seek(&mut self, frame: f64) {
        if frame.is_finite() {
            self.ended = false;
            self.jump_to(frame.max(0.0));
        }
    }

    fn jump_to(&mut self, frame: f64) {
        self.head = frame;
        self.lead = 0.0;
        self.needs_preroll = true;
        self.stretch_active = false;
        if self.scratching {
            self.scratch_target = frame;
            self.scratch_speed = 0.0;
        }
    }

    // ----- hot cues -----

    pub fn set_hot_cue(&mut self, slot: usize) {
        let pos = self.position();
        if let Some(c) = self.cues.get_mut(slot) {
            *c = Some(pos);
        }
    }

    pub fn set_hot_cue_at(&mut self, slot: usize, frame: f64) {
        if let Some(c) = self.cues.get_mut(slot) {
            *c = frame.is_finite().then_some(frame.max(0.0));
        }
    }

    pub fn clear_hot_cue(&mut self, slot: usize) {
        if let Some(c) = self.cues.get_mut(slot) {
            *c = None;
        }
    }

    pub fn hot_cue(&self, slot: usize) -> Option<f64> {
        self.cues.get(slot).copied().flatten()
    }

    /// Jumps to a hot cue. Returns `false` if the slot is empty.
    pub fn jump_to_hot_cue(&mut self, slot: usize) -> bool {
        match self.hot_cue(slot) {
            Some(frame) => {
                self.seek(frame);
                true
            }
            None => false,
        }
    }

    // ----- pitch -----

    /// Pitch fader range: 0.08, 0.16 or 0.50 (other values snap to the nearest). The current
    /// pitch is clamped into the new range.
    pub fn set_pitch_range(&mut self, range: f64) {
        let r = PITCH_RANGES
            .iter()
            .copied()
            .min_by(|a, b| (a - range).abs().total_cmp(&(b - range).abs()))
            .unwrap_or(PITCH_RANGES[0]);
        self.pitch_range = r;
        self.pitch = self.pitch.clamp(-r, r);
    }

    pub fn pitch_range(&self) -> f64 {
        self.pitch_range
    }

    /// Pitch as a fraction (+0.08 = 8 % faster), clamped to the range.
    pub fn set_pitch(&mut self, pitch: f64) {
        if pitch.is_finite() {
            self.pitch = pitch.clamp(-self.pitch_range, self.pitch_range);
        }
    }

    pub fn pitch(&self) -> f64 {
        self.pitch
    }

    /// Temporary speed nudge (pitch bend buttons / jog while playing), ±10 % at most.
    pub fn set_bend(&mut self, bend: f64) {
        if bend.is_finite() {
            self.bend = bend.clamp(-MAX_BEND, MAX_BEND);
        }
    }

    /// Current speed relative to normal (1.0 = original tempo).
    pub fn tempo(&self) -> f64 {
        (1.0 + self.pitch + self.bend).max(0.01)
    }

    pub fn set_key_lock(&mut self, on: bool) {
        if on != self.key_lock {
            let audible = self.position();
            self.key_lock = on;
            self.jump_to(audible);
        }
    }

    pub fn key_lock(&self) -> bool {
        self.key_lock
    }

    // ----- main cue (CUE / CUP) -----

    /// CUE pressed. Playing: jump back to the cue point and stop. Stopped: the cue point moves
    /// here and the track plays while the button is held (preview).
    pub fn cue_press(&mut self) {
        if self.track.is_none() {
            return;
        }
        if self.playing && !self.cue_preview {
            self.playing = false;
            self.seek(self.main_cue);
        } else {
            self.main_cue = self.position();
            self.cue_preview = true;
            self.play();
        }
    }

    /// CUE released: a preview stops and returns to the cue point.
    pub fn cue_release(&mut self) {
        if self.cue_preview {
            self.cue_preview = false;
            self.playing = false;
            self.seek(self.main_cue);
        }
    }

    /// CUP (cue-up-play): jump to the cue point and play.
    pub fn cue_play(&mut self) {
        if self.track.is_none() {
            return;
        }
        self.cue_preview = false;
        self.seek(self.main_cue);
        self.play();
    }

    pub fn main_cue(&self) -> f64 {
        self.main_cue
    }

    pub fn set_main_cue_at(&mut self, frame: f64) {
        if frame.is_finite() {
            self.main_cue = frame.max(0.0);
        }
    }

    // ----- key shift -----

    /// Transposes by `semitones` (−12 … +12), on top of key lock or pitch.
    pub fn set_key_shift(&mut self, semitones: f64) {
        if !semitones.is_finite() {
            return;
        }
        let s = semitones.clamp(-12.0, 12.0);
        let path_changes = (s == 0.0) != (self.key_shift == 0.0);
        let audible = self.position();
        self.key_shift = s;
        if path_changes {
            self.jump_to(audible);
        }
    }

    pub fn key_shift(&self) -> f64 {
        self.key_shift
    }

    fn uses_shifter(&self) -> bool {
        self.key_lock || self.key_shift != 0.0
    }

    // ----- loops -----

    /// Loop IN at the current position (an existing OUT after it keeps the loop).
    pub fn loop_set_in(&mut self) {
        let here = self.position();
        self.loop_in = Some(here);
        if self.loop_out.is_some_and(|o| o <= here) {
            self.loop_out = None;
            self.loop_active = false;
        }
    }

    /// Loop OUT at the current position; the loop starts playing if IN is before it.
    pub fn loop_set_out(&mut self) {
        let here = self.position();
        if self.loop_in.is_some_and(|i| here > i) {
            self.loop_out = Some(here);
            self.loop_active = true;
        }
    }

    /// Loop of `length` track frames starting at the current position.
    pub fn auto_loop(&mut self, length: f64) {
        if !(length.is_finite() && length > 0.0) || self.track.is_none() {
            return;
        }
        let start = self.position();
        self.loop_in = Some(start);
        self.loop_out = Some(start + length);
        self.loop_active = true;
    }

    /// Multiplies the loop length (0.5 = halve, 2.0 = double), keeping IN.
    pub fn loop_resize(&mut self, factor: f64) {
        if let (Some(i), Some(o)) = (self.loop_in, self.loop_out) {
            if factor.is_finite() && factor > 0.0 {
                let len = ((o - i) * factor).max(16.0);
                self.loop_out = Some(i + len);
            }
        }
    }

    pub fn loop_exit(&mut self) {
        self.loop_active = false;
    }

    /// Re-enters the last loop (if any) without moving the playhead.
    pub fn loop_reenter(&mut self) {
        if self.loop_in.is_some() && self.loop_out.is_some() {
            self.loop_active = true;
        }
    }

    /// (IN, OUT, active) in track frames.
    pub fn loop_state(&self) -> (Option<f64>, Option<f64>, bool) {
        (self.loop_in, self.loop_out, self.loop_active)
    }

    // ----- scratch -----

    /// The DJ grabs the platter: the record now follows [`Deck::scratch_move`].
    pub fn scratch_start(&mut self) {
        if self.track.is_none() {
            return;
        }
        let audible = self.position();
        self.jump_to(audible);
        self.scratching = true;
        self.scratch_target = audible;
        self.scratch_speed = 0.0;
    }

    /// Moves the record under the hand by `delta` track frames (negative = backwards).
    pub fn scratch_move(&mut self, delta: f64) {
        if self.scratching && delta.is_finite() {
            self.scratch_target = (self.scratch_target + delta).max(0.0);
        }
    }

    /// The DJ lets go: playback (if it was playing) continues from where the record is.
    pub fn scratch_end(&mut self) {
        if self.scratching {
            self.scratching = false;
            let here = self.head.max(0.0);
            self.jump_to(here);
        }
    }

    pub fn is_scratching(&self) -> bool {
        self.scratching
    }

    // ----- rendering -----

    /// Writes `out.len() / 2` stereo frames (interleaved). Silence when stopped or empty.
    /// Realtime-safe.
    pub fn render(&mut self, out: &mut [f32]) {
        if self.track.is_none() || !(self.playing || self.scratching) {
            out.fill(0.0);
            return;
        }
        for chunk in out.chunks_mut(2 * BLOCK) {
            if self.scratching {
                self.render_scratch(chunk);
            } else if self.uses_shifter() && self.stretch.is_some() {
                self.render_key_locked(chunk);
            } else {
                self.stretch_active = false;
                let step = self.base_step * self.tempo();
                self.render_direct(chunk, step);
            }
        }
    }

    /// Total length once decoding has finished.
    fn total(&self) -> Option<f64> {
        self.track
            .as_ref()
            .and_then(|t| t.buffer.total_frames())
            .map(|t| t as f64)
    }

    fn render_direct(&mut self, out: &mut [f32], step: f64) {
        let total = self.total();
        let Some(track) = self.track.as_ref() else {
            out.fill(0.0);
            return;
        };
        for frame in out.as_chunks_mut::<2>().0 {
            // While still decoding, frames beyond the decoded part read as silence and the
            // head keeps moving; the end is only known once decoding is done.
            if !self.playing || total.is_some_and(|t| self.head >= t) {
                if self.playing {
                    self.playing = false;
                    self.ended = true;
                }
                frame.fill(0.0);
                continue;
            }
            // Wrap before reading, so OUT itself is never played.
            if self.loop_active && step > 0.0 {
                if let (Some(i), Some(o)) = (self.loop_in, self.loop_out) {
                    if self.head >= o && o > i {
                        self.head = i + (self.head - o) % (o - i);
                    }
                }
            }
            let (l, r) = track.kernel.read(&track.buffer, self.head);
            frame[0] = l;
            frame[1] = r;
            self.head += step;
        }
    }

    fn render_scratch(&mut self, out: &mut [f32]) {
        let Some(track) = self.track.as_ref() else {
            out.fill(0.0);
            return;
        };
        let max_speed = MAX_SCRATCH_SPEED * self.base_step;
        for frame in out.as_chunks_mut::<2>().0 {
            let wanted = (self.scratch_target - self.head) * self.scratch_coeff;
            self.scratch_speed = wanted.clamp(-max_speed, max_speed);
            let (l, r) = track.kernel.read(&track.buffer, self.head);
            frame[0] = l;
            frame[1] = r;
            self.head = (self.head + self.scratch_speed).max(0.0);
        }
    }

    fn render_key_locked(&mut self, out: &mut [f32]) {
        let tempo = self.tempo();
        let step = self.base_step * tempo;
        let frames = out.len() / 2;

        if !self.stretch_active || self.needs_preroll {
            self.preroll(step);
        }
        let shift = 2f64.powf(self.key_shift / 12.0);
        let transpose = if self.key_lock { shift / tempo } else { shift };
        if let Some(stretch) = self.stretch.as_mut() {
            stretch.set_transpose(transpose as f32);
        }

        // Read ahead at full speed (pitch rises with tempo), then shift the pitch back.
        let mut input = std::mem::take(&mut self.tmp_in);
        self.render_direct(&mut input[..2 * frames], step);
        let was_ended = self.ended;
        if was_ended {
            // The read head reached the end, but the audio still inside the shifter has not
            // been heard yet: keep going until the audible position reaches the end.
            self.ended = false;
            self.playing = true;
        }
        if let Some(stretch) = self.stretch.as_mut() {
            stretch.process(&mut input[..2 * frames], out);
        }
        self.tmp_in = input;
        self.lead = self.stretch.as_ref().map_or(0.0, |s| s.latency() as f64) * step;
        if let Some(total) = self.total() {
            if self.head - self.lead >= total {
                self.playing = false;
                self.ended = true;
                self.head = total;
                self.lead = 0.0;
            }
        }
    }

    /// Resets the shifter and feeds it the audio from the current position, so its output
    /// starts exactly at the position (the read head ends up `lead` frames ahead).
    fn preroll(&mut self, step: f64) {
        let Some(stretch) = self.stretch.as_mut() else {
            return;
        };
        stretch.reset();
        let latency = stretch.latency();
        let mut input = std::mem::take(&mut self.tmp_in);
        let mut discard = std::mem::take(&mut self.tmp_out);
        let mut remaining = latency;
        while remaining > 0 {
            let n = remaining.min(BLOCK);
            self.render_direct(&mut input[..2 * n], step);
            if let Some(stretch) = self.stretch.as_mut() {
                stretch.process(&mut input[..2 * n], &mut discard[..2 * n]);
            }
            remaining -= n;
        }
        self.tmp_in = input;
        self.tmp_out = discard;
        self.lead = latency as f64 * step;
        self.stretch_active = true;
        self.needs_preroll = false;
    }
}
