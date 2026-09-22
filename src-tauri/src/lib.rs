mod commands;
mod radio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(radio::RadioState::default())
        .setup(|app| {
            radio::start_radio_proxy(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::audio::decode_audio,
            commands::lyrics::read_embedded_lyrics,
            radio::tune_radio_station,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
