//! BongPlayer music library: SQLite tag cache, analysis, crates/playlists, hot cues, settings.
//! No Tauri dependency; the app glue calls into it.

pub mod analysis;
pub mod browse;
pub mod db;
pub mod m3u;
pub mod ops;
pub mod stations;
pub mod tags;

pub use analysis::{analyze_file, Analysis, Key};
pub use db::{CrateInfo, CrateKind, Library, LibraryError, ScanStats, TrackRow};
pub use ops::{AnalysisReport, ImportReport};
pub use stations::StationRow;
