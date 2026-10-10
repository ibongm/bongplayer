//! Higher-level library operations combining files, tags, analysis and the database.

use std::path::Path;
use std::time::Instant;

use rayon::prelude::*;
use serde::Serialize;

use crate::analysis::analyze_file;
use crate::db::{CrateKind, Library, LibraryError, Result};
use crate::m3u;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub crate_id: i64,
    pub name: String,
    pub added: usize,
    /// Entries that could not be found, as written in the file.
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub analyzed: usize,
    /// (track id, error message) for files that could not be analysed.
    pub failed: Vec<(i64, String)>,
    pub seconds: f64,
}

impl Library {
    /// Imports an `.m3u` / `.m3u8` file as a new playlist named after the file.
    pub fn import_m3u(&self, path: &Path) -> Result<ImportReport> {
        let list = m3u::read(path)
            .map_err(|e| LibraryError::Invalid(format!("cannot read {}: {e}", path.display())))?;
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Imported playlist".into());
        let (rows, _) = self.tracks_for_paths(&list.found)?;
        let id = self.create_crate(&name, CrateKind::Playlist)?;
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        let added = self.add_to_crate(id, &ids)?;
        let mut missing = list.missing;
        missing.extend(
            list.urls
                .into_iter()
                .map(|u| format!("{u} (web stream; add it under Radio)")),
        );
        Ok(ImportReport {
            crate_id: id,
            name,
            added,
            missing,
        })
    }

    /// Analyses BPM and key of the given tracks in parallel and stores the results.
    pub fn analyze_tracks(&self, ids: &[i64]) -> Result<AnalysisReport> {
        let started = Instant::now();
        let rows = self.tracks_by_ids(ids)?;
        let results: Vec<_> = rows
            .par_iter()
            .map(|r| (r.id, analyze_file(&r.path)))
            .collect();
        let mut report = AnalysisReport {
            analyzed: 0,
            failed: Vec::new(),
            seconds: 0.0,
        };
        for (id, res) in results {
            match res {
                Ok(a) => {
                    let key = a.key.map(|k| k.camelot());
                    self.save_analysis(id, a.bpm, key.as_deref())?;
                    report.analyzed += 1;
                }
                Err(e) => report.failed.push((id, e.to_string())),
            }
        }
        report.seconds = started.elapsed().as_secs_f64();
        Ok(report)
    }
}
