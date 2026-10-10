//! BongPlayer desktop app: thin glue between the window (React UI), the audio engine and the
//! music library.

pub mod commands;
pub mod state;
pub mod status;
pub mod waveform;

use std::sync::Arc;

use engine::cpal_backend::CpalBackend;
use engine::output::OutputSupervisor;
use library::Library;
use tauri::Manager;

use crate::state::AppState;

/// Settings key of the preferred output device id.
pub const PREFERRED_OUTPUT_KEY: &str = "audio.preferred_output";
/// Settings key of the limiter ceiling in dBFS (written by the Audio settings tab).
pub const LIMITER_CEILING_KEY: &str = "audio.limiter_ceiling";

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("library.db");
    let library = Library::open(&db_path)?;
    let preferred = library
        .setting(PREFERRED_OUTPUT_KEY)
        .ok()
        .flatten()
        .filter(|id| !id.is_empty());

    let ceiling = library
        .setting(LIMITER_CEILING_KEY)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<f32>().ok());

    let (mut handle, engine) = engine::new_engine(48_000);
    if let Some(db) = ceiling {
        // Sent before output starts, so the first audio already uses the saved ceiling.
        let _ = handle.send(engine::Command::SetLimiterCeilingDb(db));
    }
    // If audio output cannot even start, the app still opens and shows the problem.
    let output = match OutputSupervisor::start(CpalBackend, engine, preferred) {
        Ok(o) => Some(o),
        Err(e) => {
            eprintln!("BongPlayer: audio output could not start: {e}");
            None
        }
    };
    app.manage(Arc::new(AppState::new(db_path, library, handle, output)));
    status::start(app.handle().clone());
    Ok(())
}

pub fn run() {
    use commands::*;
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            app_info,
            engine_status,
            list_drives,
            special_folders,
            list_dir,
            show_in_explorer,
            folder_tracks,
            library_tracks,
            import_paths,
            crates_list,
            crate_create,
            crate_rename,
            crate_delete,
            crate_tracks,
            crate_add,
            crate_add_paths,
            crate_remove,
            import_m3u,
            analyze_tracks,
            mark_played,
            remove_tracks,
            set_rating,
            set_bpm,
            setting_get,
            setting_set,
            deck_load,
            deck_load_path,
            hot_cue_set,
            hot_cue_clear,
            engine_command,
            deck_waveform,
            output_devices,
            set_preferred_output,
            queue_list,
            queue_add,
            queue_add_paths,
            queue_move,
            queue_remove,
            queue_clear,
            queue_shuffle,
        ])
        .run(tauri::generate_context!());
    if let Err(err) = result {
        eprintln!("BongPlayer failed to start: {err}");
        std::process::exit(1);
    }
}
