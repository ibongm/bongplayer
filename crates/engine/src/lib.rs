//! BongPlayer audio engine.
//!
//! Pure Rust, no Tauri. Everything that makes sound lives here, and every part of the audio
//! graph can be run by the offline renderer so behaviour is verified by tests, not by ear.

pub mod decode;
mod mp4_edit;
pub mod track;

pub use decode::{decode_to_end, start_decoding, DecodeError, DecodingTrack};
pub use track::{DecodeState, TrackBuffer};
