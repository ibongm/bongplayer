//! BongPlayer audio engine.
//!
//! Pure Rust, no Tauri. Everything that makes sound lives here, and every part of the audio
//! graph can be run by the offline renderer so behaviour is verified by tests, not by ear.

pub mod cpal_backend;
pub mod deck;
pub mod decode;
pub mod effects;
pub mod engine;
pub mod eq;
pub mod filter;
pub mod fx;
pub mod limiter;
pub mod live;
pub mod mixer;
mod mp4_edit;
pub mod offline;
pub mod output;
pub mod resample;
pub mod sampler;
pub mod strip;
pub mod track;

pub use decode::{
    decode_excerpt, decode_to_end, start_decoding, DecodeError, DecodingTrack, Excerpt,
};
pub use engine::{
    new_engine, Command, DeckId, Engine, EngineError, EngineHandle, EngineStatus, TransitionStyle,
};
pub use track::{DecodeState, TrackBuffer};
