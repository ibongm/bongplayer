//! Local Icecast/Shoutcast TCP proxy (Phase 8, Windows-only per AGENTS.md
//! §1 — no cross-platform socket concerns to worry about here).
//!
//! Two problems this solves: (1) WebView2's `<audio>` element has no
//! built-in support for ICY-metadata-interleaved streams — the interleaved
//! metadata blocks would otherwise land in the middle of the audio bytes
//! and corrupt playback; (2) exposing raw third-party stream URLs directly
//! to `<audio src>` mixes them into this app's strict CSP `media-src` list
//! one station at a time, whereas a single well-known local origin only
//! needs listing once (see `src-tauri/tauri.conf.json`).
//!
//! This binds a tiny hand-rolled HTTP server on 127.0.0.1:17420 (std::net
//! only — no HTTP client crate; AGENTS.md §7 prefers avoiding unnecessary
//! third-party dependencies when the standard library suffices for
//! something this small). It fetches the tuned upstream station itself,
//! strips the interleaved ICY metadata blocks before forwarding audio bytes
//! to the client, and emits a `radio://title-changed` Tauri event with the
//! extracted "now playing" title whenever it changes.
//!
//! **Known limitation**: only `http://` upstream URLs are supported.
//! `https://` would need a TLS client crate, which isn't worth the added
//! dependency weight for this feature — the vast majority of small
//! Icecast/Shoutcast stations are still plain HTTP.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager};

const PROXY_PORT: u16 = 17420;
const ICY_TITLE_EVENT: &str = "radio://title-changed";

#[derive(Default)]
pub struct RadioState {
    upstream_url: Mutex<Option<String>>,
}

struct ParsedUrl {
    host: String,
    port: u16,
    path: String,
}

fn parse_http_url(url: &str) -> Result<ParsedUrl, String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "only http:// radio stream URLs are supported".to_string())?;
    let (authority, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port_str)) => (
            host.to_string(),
            port_str
                .parse::<u16>()
                .map_err(|_| "invalid port in stream URL".to_string())?,
        ),
        None => (authority.to_string(), 80),
    };
    if host.is_empty() {
        return Err("stream URL is missing a host".to_string());
    }
    Ok(ParsedUrl {
        host,
        port,
        path: path.to_string(),
    })
}

/// Sets the station this proxy serves and returns the local proxy URL the
/// frontend's `<audio>` element should point its `src` at.
#[tauri::command]
pub fn tune_radio_station(url: String, state: tauri::State<RadioState>) -> Result<String, String> {
    parse_http_url(&url)?; // validate eagerly so the frontend gets an immediate, specific error
    *state.upstream_url.lock().unwrap() = Some(url);
    Ok(format!("http://127.0.0.1:{PROXY_PORT}/stream"))
}

fn extract_stream_title(meta_bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(meta_bytes);
    let start = text.find("StreamTitle='")? + "StreamTitle='".len();
    let end = text[start..].find("';")? + start;
    Some(text[start..end].to_string())
}

/// Connects upstream, sends the ICY-metadata-requesting GET, and returns the
/// reader positioned right after the response headers plus the parsed
/// `icy-metaint` (byte interval between metadata blocks, if any) and the
/// upstream's declared content type.
fn fetch_icy_stream(url: &str) -> Result<(BufReader<TcpStream>, Option<usize>, String), String> {
    let parsed = parse_http_url(url)?;
    let mut stream = TcpStream::connect((parsed.host.as_str(), parsed.port))
        .map_err(|error| format!("failed to connect to radio stream: {error}"))?;

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nIcy-MetaData: 1\r\nUser-Agent: BongPlayer/1.0\r\nConnection: close\r\n\r\n",
        parsed.path, parsed.host
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to send request to radio stream: {error}"))?;

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .map_err(|error| format!("failed to read radio stream response: {error}"))?;

    let mut content_type = "audio/mpeg".to_string();
    let mut metaint: Option<usize> = None;
    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read radio stream headers: {error}"))?;
        if bytes_read == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim().to_string();
            match name.as_str() {
                "icy-metaint" => metaint = value.parse::<usize>().ok(),
                "content-type" => content_type = value,
                _ => {}
            }
        }
    }

    Ok((reader, metaint, content_type))
}

fn read_and_emit_icy_metadata(
    upstream: &mut BufReader<TcpStream>,
    app: &AppHandle,
    last_title: &mut Option<String>,
) -> bool {
    let mut len_byte = [0u8; 1];
    if upstream.read_exact(&mut len_byte).is_err() {
        return false;
    }
    let meta_len = len_byte[0] as usize * 16;
    if meta_len == 0 {
        return true; // no metadata this cycle — nothing changed
    }
    let mut meta_buf = vec![0u8; meta_len];
    if upstream.read_exact(&mut meta_buf).is_err() {
        return false;
    }
    if let Some(title) = extract_stream_title(&meta_buf) {
        if last_title.as_deref() != Some(title.as_str()) {
            let _ = app.emit(ICY_TITLE_EVENT, title.clone());
            *last_title = Some(title);
        }
    }
    true
}

fn stream_audio_with_icy_metadata(
    upstream: &mut BufReader<TcpStream>,
    client: &mut TcpStream,
    metaint: Option<usize>,
    app: &AppHandle,
) {
    let mut bytes_until_meta = metaint.unwrap_or(usize::MAX);
    let mut last_title: Option<String> = None;
    let mut buf = [0u8; 4096];

    loop {
        let chunk_limit = buf.len().min(bytes_until_meta.max(1));
        let read_bytes = match upstream.read(&mut buf[..chunk_limit]) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };

        if client.write_all(&buf[..read_bytes]).is_err() {
            break;
        }

        if let Some(interval) = metaint {
            bytes_until_meta -= read_bytes;
            if bytes_until_meta == 0 {
                if !read_and_emit_icy_metadata(upstream, app, &mut last_title) {
                    break;
                }
                bytes_until_meta = interval;
            }
        }
    }
}

fn write_simple_http_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status} Error\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)
}

fn handle_client(client: TcpStream, app: AppHandle) {
    let mut reader = BufReader::new(client);
    let mut request_line = String::new();
    // Only the fact that a request arrived matters — this proxy always
    // serves the one currently-tuned station regardless of request path.
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut client = reader.into_inner();

    let upstream_url = {
        let state = app.state::<RadioState>();
        let guard = state.upstream_url.lock().unwrap();
        guard.clone()
    };

    let Some(upstream_url) = upstream_url else {
        let _ = write_simple_http_response(&mut client, 503, "text/plain", b"No station tuned");
        return;
    };

    let (mut upstream_reader, metaint, content_type) = match fetch_icy_stream(&upstream_url) {
        Ok(result) => result,
        Err(error) => {
            let _ = write_simple_http_response(&mut client, 502, "text/plain", error.as_bytes());
            return;
        }
    };

    let response_headers = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    );
    if client.write_all(response_headers.as_bytes()).is_err() {
        return;
    }

    stream_audio_with_icy_metadata(&mut upstream_reader, &mut client, metaint, &app);
}

/// Starts the proxy's accept loop on a background OS thread. Safe to call
/// once at app startup — binding failure (e.g. the port is already in use)
/// is logged and otherwise non-fatal, since radio is an optional feature.
pub fn start_radio_proxy(app: AppHandle) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PROXY_PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("radio proxy: failed to bind 127.0.0.1:{PROXY_PORT}: {error}");
                return;
            }
        };

        for incoming in listener.incoming() {
            let Ok(client) = incoming else { continue };
            let app = app.clone();
            thread::spawn(move || handle_client(client, app));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_host_port_and_path() {
        let parsed = parse_http_url("http://stream.example.com:8000/radio.mp3").unwrap();
        assert_eq!(parsed.host, "stream.example.com");
        assert_eq!(parsed.port, 8000);
        assert_eq!(parsed.path, "/radio.mp3");
    }

    #[test]
    fn defaults_to_port_80_and_root_path() {
        let parsed = parse_http_url("http://stream.example.com").unwrap();
        assert_eq!(parsed.port, 80);
        assert_eq!(parsed.path, "/");
    }

    #[test]
    fn rejects_https_urls() {
        assert!(parse_http_url("https://stream.example.com").is_err());
    }

    #[test]
    fn rejects_urls_with_no_host() {
        assert!(parse_http_url("http://").is_err());
    }

    #[test]
    fn extracts_a_stream_title_from_an_icy_metadata_block() {
        let meta = b"StreamTitle='Artist - Track Name';StreamUrl='http://example.com';";
        assert_eq!(
            extract_stream_title(meta),
            Some("Artist - Track Name".to_string())
        );
    }

    #[test]
    fn returns_none_for_metadata_without_a_stream_title() {
        assert_eq!(extract_stream_title(b"StreamUrl='http://example.com';"), None);
    }
}
