//! Saved internet radio stations.

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::{now, Library, LibraryError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRow {
    pub id: i64,
    pub name: String,
    pub url: String,
    /// How long Automix plays this station before moving on, in minutes.
    pub play_minutes: u32,
}

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS stations (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    url           TEXT NOT NULL,
    play_minutes  INTEGER NOT NULL DEFAULT 60,
    created       INTEGER NOT NULL
)";

fn validate(name: &str, url: &str, minutes: u32) -> Result<()> {
    if name.trim().is_empty() {
        return Err(LibraryError::Invalid("the station needs a name".into()));
    }
    let u = url.trim().to_ascii_lowercase();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err(LibraryError::Invalid(
            "the address must start with http:// or https://".into(),
        ));
    }
    if !(1..=24 * 60).contains(&minutes) {
        return Err(LibraryError::Invalid(
            "play time must be between 1 minute and 24 hours".into(),
        ));
    }
    Ok(())
}

impl Library {
    fn ensure_stations(&self) -> Result<()> {
        self.conn().execute_batch(SCHEMA)?;
        Ok(())
    }

    pub fn stations(&self) -> Result<Vec<StationRow>> {
        self.ensure_stations()?;
        let mut q = self.conn().prepare_cached(
            "SELECT id, name, url, play_minutes FROM stations ORDER BY name COLLATE NOCASE",
        )?;
        let rows = q
            .query_map([], |r| {
                Ok(StationRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    url: r.get(2)?,
                    play_minutes: r.get::<_, i64>(3)?.clamp(1, 24 * 60) as u32,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn station(&self, id: i64) -> Result<StationRow> {
        self.stations()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| LibraryError::NotFound(format!("station {id}")))
    }

    /// Creates (`id` None) or updates a station; returns its id.
    pub fn save_station(
        &self,
        id: Option<i64>,
        name: &str,
        url: &str,
        play_minutes: u32,
    ) -> Result<i64> {
        self.ensure_stations()?;
        validate(name, url, play_minutes)?;
        let (name, url) = (name.trim(), url.trim());
        match id {
            Some(id) => {
                let n = self.conn().execute(
                    "UPDATE stations SET name = ?2, url = ?3, play_minutes = ?4 WHERE id = ?1",
                    params![id, name, url, i64::from(play_minutes)],
                )?;
                if n == 0 {
                    return Err(LibraryError::NotFound(format!("station {id}")));
                }
                Ok(id)
            }
            None => {
                let existing: Option<i64> = self
                    .conn()
                    .query_row("SELECT id FROM stations WHERE url = ?1", [url], |r| {
                        r.get(0)
                    })
                    .optional()?;
                if let Some(id) = existing {
                    return self.save_station(Some(id), name, url, play_minutes);
                }
                self.conn().execute(
                    "INSERT INTO stations (name, url, play_minutes, created) VALUES (?1, ?2, ?3, ?4)",
                    params![name, url, i64::from(play_minutes), now()],
                )?;
                Ok(self.conn().last_insert_rowid())
            }
        }
    }

    pub fn delete_station(&self, id: i64) -> Result<()> {
        self.ensure_stations()?;
        let n = self
            .conn()
            .execute("DELETE FROM stations WHERE id = ?1", [id])?;
        if n == 0 {
            return Err(LibraryError::NotFound(format!("station {id}")));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_update_delete_and_validate() {
        let lib = Library::open_in_memory().expect("db");
        let id = lib
            .save_station(
                None,
                "Radio Dalmacija",
                "http://shoutcast.pondi.hr:8000/listen.pls",
                60,
            )
            .expect("save");
        // Same address again updates instead of duplicating.
        let again = lib
            .save_station(
                None,
                "Dalmacija",
                "http://shoutcast.pondi.hr:8000/listen.pls",
                30,
            )
            .expect("save");
        assert_eq!(id, again);
        let s = lib.station(id).expect("get");
        assert_eq!((s.name.as_str(), s.play_minutes), ("Dalmacija", 30));
        assert!(lib.save_station(None, "", "http://x", 60).is_err());
        assert!(lib.save_station(None, "X", "ftp://x", 60).is_err());
        assert!(lib.save_station(None, "X", "http://x", 0).is_err());
        lib.delete_station(id).expect("delete");
        assert!(lib.stations().expect("list").is_empty());
        assert!(lib.delete_station(id).is_err());
    }
}
