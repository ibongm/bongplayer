//! A deck: one loaded track, a read head, transport and hot cues.
//!
//! Positions are in frames of the *track's* sample rate, as `f64`, so cue points stay exact
//! whatever the output device runs at.

use std::sync::Arc;

use crate::resample::SincTable;
use crate::track::TrackBuffer;

pub const HOT_CUES: usize = 8;

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

#[derive(Debug, Default)]
pub struct Deck {
    track: Option<LoadedTrack>,
    out_rate: u32,
    /// Read head in track frames.
    position: f64,
    /// Track frames advanced per output frame (file rate / output rate at 0 % pitch).
    step: f64,
    playing: bool,
    /// Set when playback ran off the end of the track.
    ended: bool,
    cues: [Option<f64>; HOT_CUES],
}

impl Deck {
    pub fn new(out_rate: u32) -> Self {
        Self {
            out_rate,
            ..Self::default()
        }
    }

    /// Switches to a new output rate (e.g. after the sound card changed), keeping the track,
    /// position, transport and cues. Rebuilds the kernel, so it allocates: not on the audio thread.
    pub fn set_out_rate(&mut self, out_rate: u32) {
        self.out_rate = out_rate;
        if let Some(track) = self.track.as_mut() {
            let file_rate = track.buffer.sample_rate();
            self.step = f64::from(file_rate) / f64::from(out_rate.max(1));
            track.kernel = Arc::new(SincTable::for_rates(file_rate, out_rate));
        }
    }

    /// Puts a track on the deck, stopped at the start, and returns the previous one so the
    /// caller can free it off the audio thread. Hot cues are cleared (they belong to a track).
    pub fn load(&mut self, track: LoadedTrack) -> Option<LoadedTrack> {
        self.step = f64::from(track.buffer.sample_rate()) / f64::from(self.out_rate.max(1));
        self.position = 0.0;
        self.playing = false;
        self.ended = false;
        self.cues = [None; HOT_CUES];
        self.track.replace(track)
    }

    pub fn unload(&mut self) -> Option<LoadedTrack> {
        self.playing = false;
        self.ended = false;
        self.position = 0.0;
        self.track.take()
    }

    pub fn track(&self) -> Option<&LoadedTrack> {
        self.track.as_ref()
    }

    pub fn play(&mut self) {
        if self.track.is_some() {
            self.playing = true;
            self.ended = false;
        }
    }

    pub fn pause(&mut self) {
        self.playing = false;
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn has_ended(&self) -> bool {
        self.ended
    }

    /// Current position in track frames.
    pub fn position(&self) -> f64 {
        self.position
    }

    /// Moves the read head to `frame` (track frames), clamped to the start of the track.
    pub fn seek(&mut self, frame: f64) {
        if frame.is_finite() {
            self.position = frame.max(0.0);
            self.ended = false;
        }
    }

    pub fn set_hot_cue(&mut self, slot: usize) {
        if let Some(c) = self.cues.get_mut(slot) {
            *c = Some(self.position);
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

    /// Writes `out.len() / 2` stereo frames (interleaved). Silence when stopped or empty.
    /// Realtime-safe.
    pub fn render(&mut self, out: &mut [f32]) {
        let Some(track) = self.track.as_ref().filter(|_| self.playing) else {
            out.fill(0.0);
            return;
        };
        let buffer = &track.buffer;
        for frame in out.as_chunks_mut::<2>().0 {
            // While still decoding, frames beyond the decoded part read as silence and the
            // head keeps moving; the end is only known once decoding is done.
            if let Some(total) = buffer.total_frames() {
                if self.position >= total as f64 {
                    self.playing = false;
                    self.ended = true;
                    frame.fill(0.0);
                    continue;
                }
            }
            if !self.playing {
                frame.fill(0.0);
                continue;
            }
            let (l, r) = track.kernel.read(buffer, self.position);
            frame[0] = l;
            frame[1] = r;
            self.position += self.step;
        }
    }
}
