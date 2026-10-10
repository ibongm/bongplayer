use serde::Serialize;

/// Basic information about the running app, shown in the titlebar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "BongPlayer".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

pub fn run() {
    if let Err(err) = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
    {
        eprintln!("BongPlayer failed to start: {err}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_name_and_crate_version() {
        let info = app_info();
        assert_eq!(info.name, "BongPlayer");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn app_info_serialises_to_the_ipc_shape() {
        let json = serde_json::to_value(app_info()).expect("serialise");
        assert!(json.get("name").is_some_and(|v| v.is_string()));
        assert!(json.get("version").is_some_and(|v| v.is_string()));
    }
}
