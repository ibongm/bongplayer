//! M3 acceptance (library side): tag cache, 50,000-track library speed, analysis benchmark,
//! crates & playlists, `.m3u` import.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use library::{CrateKind, Key, Library};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// Copies a fixture into `dir` under `count` different names.
fn copies(dir: &Path, name: &str, count: usize) -> Vec<PathBuf> {
    (0..count)
        .map(|i| {
            let p = dir.join(format!("{i:03} - Artist {i} - Title {i}.mp3"));
            std::fs::copy(fixture(name), &p).expect("copy");
            p
        })
        .collect()
}

#[test]
fn tag_cache_hit_avoids_rereading_files() {
    let dir = tempfile::tempdir().expect("tmp");
    let files = copies(dir.path(), "song_128bpm_Am.mp3", 10);
    let lib = Library::open(&dir.path().join("lib.db")).expect("open");

    let (rows, stats) = lib.tracks_for_paths(&files).expect("scan");
    assert_eq!(rows.len(), 10);
    assert_eq!((stats.read, stats.cached), (10, 0));
    // Untagged files: artist/title come from the file name.
    assert_eq!(rows[3].artist, "Artist 3");
    assert_eq!(rows[3].title, "Title 3");
    assert!(rows[3]
        .duration_ms
        .is_some_and(|d| (69_000..71_000).contains(&d)));

    let (rows2, stats) = lib.tracks_for_paths(&files).expect("rescan");
    assert_eq!(
        (stats.read, stats.cached),
        (0, 10),
        "second scan must come from the cache"
    );
    assert_eq!(rows, rows2);

    // A changed file is read again; the others stay cached.
    std::fs::write(
        &files[4],
        std::fs::read(fixture("song_82bpm_G.mp3")).expect("read"),
    )
    .expect("overwrite");
    let f = std::fs::OpenOptions::new()
        .write(true)
        .open(&files[4])
        .expect("open");
    f.set_modified(std::time::SystemTime::now() + Duration::from_secs(10))
        .expect("touch");
    drop(f);
    let (_, stats) = lib.tracks_for_paths(&files).expect("rescan");
    assert_eq!((stats.read, stats.cached), (1, 9));

    // A deleted file is flagged missing, not silently dropped from the library.
    std::fs::remove_file(&files[0]).expect("rm");
    lib.tracks_for_paths(&files).expect("rescan");
    let all = lib.all_tracks().expect("all");
    assert!(all.iter().any(|r| r.path == files[0] && r.missing));
}

#[test]
fn library_of_50000_tracks_opens_in_under_a_second() {
    let dir = tempfile::tempdir().expect("tmp");
    let db = dir.path().join("big.db");
    // Create the schema, then fill it directly (50,000 real files would take minutes).
    drop(Library::open(&db).expect("create"));
    {
        let conn = rusqlite::Connection::open(&db).expect("raw");
        conn.execute_batch("BEGIN").expect("begin");
        let mut q = conn
            .prepare(
                "INSERT INTO tracks (path, folder, file_size, file_mtime, title, artist, album,
                 genre, year, duration_ms, bpm, musical_key, first_seen)
                 VALUES (?1, ?2, 1000, 0, ?3, ?4, ?5, 'House', 2020, 240000, 124.0, '8A', 0)",
            )
            .expect("prepare");
        for i in 0..50_000 {
            let folder = format!(r"D:\Music\Folder {}", i / 100);
            q.execute(rusqlite::params![
                format!(r"{folder}\Track {i}.mp3"),
                folder,
                format!("Title {i}"),
                format!("Artist {}", i % 977),
                format!("Album {}", i / 12),
            ])
            .expect("insert");
        }
        drop(q);
        conn.execute_batch("COMMIT").expect("commit");
    }
    let start = Instant::now();
    let lib = Library::open(&db).expect("open");
    let rows = lib.all_tracks().expect("all");
    let took = start.elapsed();
    println!("50,000-track library opened in {took:?}");
    assert_eq!(rows.len(), 50_000);
    assert!(took < Duration::from_secs(1), "took {took:?}");
}

#[test]
fn analysis_of_mp3_files_is_correct() {
    let dir = tempfile::tempdir().expect("tmp");
    let lib = Library::open(&dir.path().join("lib.db")).expect("open");
    let files: Vec<PathBuf> = [
        "song_128bpm_Am.mp3",
        "song_82bpm_G.mp3",
        "song_168bpm_E.mp3",
    ]
    .iter()
    .map(|n| fixture(n))
    .collect();
    let (rows, _) = lib.tracks_for_paths(&files).expect("scan");
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    let report = lib.analyze_tracks(&ids).expect("analyze");
    assert_eq!(report.analyzed, 3, "{:?}", report.failed);
    let rows = lib.tracks_by_ids(&ids).expect("rows");
    let expected = [(128.0, "8A"), (82.0, "9B"), (168.0, "12B")];
    for (row, (bpm, key)) in rows.iter().zip(expected) {
        let got = row.bpm.expect("bpm");
        println!("{}: {got} BPM, key {:?}", row.path.display(), row.key);
        assert!(
            (got - bpm).abs() <= 0.5,
            "{}: {got} BPM, expected {bpm}",
            row.path.display()
        );
        assert_eq!(row.key.as_deref(), Some(key));
        assert_eq!(Key::parse(key).map(|k| k.camelot()).as_deref(), Some(key));
        assert!(row.analyzed);
    }
}

#[test]
fn analysis_benchmark_at_least_5_tracks_per_second() {
    let dir = tempfile::tempdir().expect("tmp");
    let files = copies(dir.path(), "song_128bpm_Am.mp3", 24);
    let lib = Library::open(&dir.path().join("lib.db")).expect("open");
    let (rows, _) = lib.tracks_for_paths(&files).expect("scan");
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    let report = lib.analyze_tracks(&ids).expect("analyze");
    assert_eq!(report.analyzed, 24);
    let rate = 24.0 / report.seconds;
    println!(
        "analysis: {rate:.1} tracks/s on {} threads",
        std::thread::available_parallelism().map_or(1, |n| n.get())
    );
    assert!(rate >= 5.0, "only {rate:.1} tracks/s");
}

#[test]
fn bpm_override_and_counters() {
    let dir = tempfile::tempdir().expect("tmp");
    let files = copies(dir.path(), "song_128bpm_Am.mp3", 2);
    let lib = Library::open(&dir.path().join("lib.db")).expect("open");
    let (rows, _) = lib.tracks_for_paths(&files).expect("scan");
    let id = rows[0].id;
    lib.save_analysis(id, Some(64.0), Some("8A")).expect("save");
    assert_eq!(lib.track(id).expect("row").bpm, Some(64.0));
    lib.set_bpm_override(&[id], Some(128.0)).expect("override");
    let r = lib.track(id).expect("row");
    assert_eq!((r.bpm, r.bpm_is_manual), (Some(128.0), true));
    lib.set_bpm_override(&[id], None).expect("clear");
    assert_eq!(lib.track(id).expect("row").bpm, Some(64.0));
    assert!(lib.set_bpm_override(&[id], Some(1000.0)).is_err());

    assert_eq!(lib.mark_played(&[id, rows[1].id]).expect("played"), 2);
    lib.mark_played(&[id]).expect("played");
    let r = lib.track(id).expect("row");
    assert_eq!(r.play_count, 2);
    assert!(r.last_played.is_some());
    lib.set_rating(&[id], 9).expect("rating");
    assert_eq!(lib.track(id).expect("row").rating, 5);

    lib.set_hot_cue(id, 0, 44_100.0).expect("cue");
    lib.set_hot_cue(id, 7, 88_200.5).expect("cue");
    lib.set_hot_cue(id, 0, 1.0).expect("cue");
    assert_eq!(
        lib.hot_cues(id).expect("cues"),
        vec![(0, 1.0), (7, 88_200.5)]
    );
    lib.clear_hot_cue(id, 0).expect("clear");
    assert_eq!(lib.hot_cues(id).expect("cues").len(), 1);

    lib.set_setting("theme", "midnight-slate").expect("set");
    assert_eq!(
        lib.setting("theme").expect("get").as_deref(),
        Some("midnight-slate")
    );
    assert_eq!(lib.setting("nope").expect("get"), None);

    assert_eq!(lib.remove_tracks(&[id]).expect("remove"), 1);
    assert_eq!(lib.track_count().expect("count"), 1);
    assert!(
        lib.hot_cues(id).expect("cues").is_empty(),
        "cues removed with the track"
    );
}

#[test]
fn crates_and_playlists_create_rename_delete() {
    let dir = tempfile::tempdir().expect("tmp");
    let files = copies(dir.path(), "song_128bpm_Am.mp3", 3);
    let lib = Library::open(&dir.path().join("lib.db")).expect("open");
    let (rows, _) = lib.tracks_for_paths(&files).expect("scan");
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();

    let night = lib
        .create_crate("Friday night", CrateKind::Crate)
        .expect("crate");
    let set = lib
        .create_crate("Warm-up set", CrateKind::Playlist)
        .expect("playlist");
    assert!(lib.create_crate("   ", CrateKind::Crate).is_err());

    // A crate holds each track once; a playlist keeps order and duplicates.
    assert_eq!(
        lib.add_to_crate(night, &[ids[0], ids[1], ids[0]])
            .expect("add"),
        2
    );
    assert_eq!(
        lib.add_to_crate(set, &[ids[2], ids[0], ids[2]])
            .expect("add"),
        3
    );
    let order: Vec<i64> = lib
        .crate_tracks(set)
        .expect("tracks")
        .iter()
        .map(|(_, r)| r.id)
        .collect();
    assert_eq!(order, vec![ids[2], ids[0], ids[2]]);

    lib.rename_crate(night, "Saturday night").expect("rename");
    let crates = lib.crates().expect("list");
    assert_eq!(crates.len(), 2);
    let sat = crates.iter().find(|c| c.id == night).expect("found");
    assert_eq!((sat.name.as_str(), sat.track_count), ("Saturday night", 2));

    // Remove the middle playlist entry by position.
    let positions: Vec<i64> = lib
        .crate_tracks(set)
        .expect("t")
        .iter()
        .map(|(p, _)| *p)
        .collect();
    lib.remove_from_crate(set, &[positions[1]]).expect("remove");
    assert_eq!(lib.crate_tracks(set).expect("t").len(), 2);

    lib.delete_crate(night).expect("delete");
    assert!(lib.delete_crate(night).is_err());
    assert_eq!(lib.crates().expect("list").len(), 1);
    assert_eq!(
        lib.track_count().expect("count"),
        3,
        "deleting a crate keeps the tracks"
    );
}

#[test]
fn m3u_import_relative_absolute_and_missing() {
    let dir = tempfile::tempdir().expect("tmp");
    let music = dir.path().join("Music");
    std::fs::create_dir(&music).expect("mkdir");
    let files = copies(&music, "song_128bpm_Am.mp3", 2);
    let list = dir.path().join("Friday set.m3u8");
    let text = format!(
        "#EXTM3U\nMusic/{}\n{}\nMusic/gone.mp3\nhttp://radio.example/live\n",
        files[0].file_name().unwrap_or_default().to_string_lossy(),
        files[1].display()
    );
    std::fs::write(&list, text).expect("write");

    let lib = Library::open(&dir.path().join("lib.db")).expect("open");
    let report = lib.import_m3u(&list).expect("import");
    assert_eq!(report.name, "Friday set");
    assert_eq!(report.added, 2);
    assert_eq!(report.missing.len(), 2);
    assert!(report.missing[0].contains("gone.mp3"));
    assert!(report.missing[1].contains("radio.example"));
    let tracks = lib.crate_tracks(report.crate_id).expect("tracks");
    assert_eq!(tracks.len(), 2);
    assert_eq!(tracks[0].1.path, files[0]);
    let info = lib.crates().expect("crates");
    assert_eq!(info[0].kind, CrateKind::Playlist);
}
