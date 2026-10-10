//! M6 acceptance: a fake local Icecast server covers plain MP3, AAC, redirect, `.pls`,
//! `.m3u`, ICY title changes, mid-stream disconnect → reconnect; an HTML page URL gives a
//! clear "this is a web page, not a stream" message.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use engine::live::LiveBuffer;
use radio::{probe, RadioError, Station};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name),
    )
    .expect("fixture")
}

fn meta_block(title: &str) -> Vec<u8> {
    let text = format!("StreamTitle='{title}';");
    let blocks = text.len().div_ceil(16);
    let mut v = vec![blocks as u8];
    v.extend(text.as_bytes());
    v.resize(1 + blocks * 16, 0);
    v
}

struct Server {
    port: u16,
}

const METAINT: usize = 4096;

/// Streams `audio` (looped) for about `seconds_of_bytes` bytes, optionally with ICY titles.
fn stream_audio(s: &mut TcpStream, audio: &[u8], total: usize, icy: bool) {
    let mut sent = 0usize;
    let mut pos = 0usize;
    let mut since_meta = 0usize;
    let mut meta_count = 0usize;
    while sent < total {
        let mut chunk = Vec::with_capacity(METAINT + 64);
        while chunk.len() < 1024 {
            let take = (audio.len() - pos).min(1024 - chunk.len());
            let take = if icy {
                take.min(METAINT - since_meta)
            } else {
                take
            };
            chunk.extend_from_slice(&audio[pos..pos + take]);
            pos = (pos + take) % audio.len();
            since_meta += take;
            if icy && since_meta == METAINT {
                meta_count += 1;
                // Title changes after 40 blocks (~160 KB ≈ 10 s of 128 kbps audio).
                let title = if meta_count < 40 {
                    "Artist A - Song 1"
                } else {
                    "Artist B - Song 2"
                };
                chunk.extend(meta_block(title));
                since_meta = 0;
            }
        }
        if s.write_all(&chunk).is_err() {
            return;
        }
        sent += chunk.len();
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn start_server() -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let mp3 = Arc::new(fixture("tone_44100.mp3"));
    let aac = Arc::new(fixture("tone_44100.aac"));
    let drops = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut s) = conn else { continue };
            let (mp3, aac, drops) = (Arc::clone(&mp3), Arc::clone(&aac), Arc::clone(&drops));
            std::thread::spawn(move || {
                let mut reader = BufReader::new(s.try_clone().expect("clone"));
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    return;
                }
                loop {
                    let mut l = String::new();
                    if reader.read_line(&mut l).is_err() || l.trim().is_empty() {
                        break;
                    }
                }
                let path = first.split_whitespace().nth(1).unwrap_or("/").to_string();
                let base = format!("http://127.0.0.1:{port}");
                let head = |ct: &str, extra: &str| {
                    format!("HTTP/1.0 200 OK\r\nContent-Type: {ct}\r\n{extra}\r\n")
                };
                let _ = match path.as_str() {
                    "/mp3" => {
                        let _ = s.write_all(head("audio/mpeg", &format!("icy-metaint: {METAINT}\r\nicy-name: Test FM\r\n")).as_bytes());
                        stream_audio(&mut s, &mp3, 2_000_000, true);
                        Ok(())
                    }
                    "/aac" => {
                        let _ = s.write_all(head("audio/aac", "").as_bytes());
                        stream_audio(&mut s, &aac, 1_000_000, false);
                        Ok(())
                    }
                    "/icy" => {
                        let _ = s.write_all(format!("ICY 200 OK\r\nicy-metaint:{METAINT}\r\ncontent-type:audio/mpeg\r\n\r\n").as_bytes());
                        stream_audio(&mut s, &mp3, 1_000_000, true);
                        Ok(())
                    }
                    "/redirect" => s.write_all(b"HTTP/1.0 302 Found\r\nLocation: /mp3\r\n\r\n"),
                    "/radio.php" => s.write_all(format!("HTTP/1.0 302 Found\r\nLocation: {base}/aac\r\n\r\n").as_bytes()),
                    "/list.pls" => s.write_all(
                        format!("{}[playlist]\nNumberOfEntries=1\nFile1={base}/mp3\nTitle1=Test\n", head("audio/x-scpls", "")).as_bytes(),
                    ),
                    "/list.m3u" => s.write_all(format!("{}#EXTM3U\n#EXTINF:-1,Test\n{base}/aac\n", head("audio/x-mpegurl", "")).as_bytes()),
                    "/player.html" => s.write_all(
                        format!("{}<!DOCTYPE html><html><head><title>Radio player</title></head><body><audio></audio></body></html>", head("text/html; charset=utf-8", "")).as_bytes(),
                    ),
                    "/live.m3u8" => s.write_all(
                        format!("{}#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\nseg1.aac\n", head("application/vnd.apple.mpegurl", "")).as_bytes(),
                    ),
                    "/drop" => {
                        let n = drops.fetch_add(1, Ordering::SeqCst);
                        let _ = s.write_all(head("audio/mpeg", "").as_bytes());
                        // First connection: about 1 s of audio, then the server "crashes".
                        let total = if n == 0 { 16_000 } else { 1_000_000 };
                        stream_audio(&mut s, &mp3, total, false);
                        Ok(())
                    }
                    _ => s.write_all(b"HTTP/1.0 404 Not Found\r\n\r\n"),
                };
            });
        }
    });
    Server { port }
}

fn wait(what: &str, secs: u64, mut cond: impl FnMut() -> bool) {
    let start = Instant::now();
    while !cond() {
        assert!(
            start.elapsed() < Duration::from_secs(secs),
            "timed out waiting for: {what}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Plays a URL until one second of audio has arrived; checks rate and that it is the tone.
fn plays(url: &str) -> Station {
    let live = Arc::new(LiveBuffer::new(48_000));
    let station = Station::start(url, Arc::clone(&live));
    wait(&format!("audio from {url}"), 15, || {
        live.written() >= 44_100
    });
    assert_eq!(live.sample_rate(), 44_100, "{url}");
    assert_eq!(live.state(), "playing", "{url}");
    // The 1 kHz tone at amplitude 0.5 arrives intact.
    let w = live.written() as i64;
    let peak = (w - 4_000..w - 100)
        .map(|i| live.frame(i).0.abs())
        .fold(0.0f32, f32::max);
    assert!((0.4..0.6).contains(&peak), "{url}: peak {peak}");
    station
}

#[test]
fn plain_mp3_with_icy_title_changes() {
    let srv = start_server();
    let url = format!("http://127.0.0.1:{}/mp3", srv.port);
    let mut st = plays(&url);
    let live = Arc::clone(&st.live);
    wait("first title", 10, || live.title() == "Artist A - Song 1");
    wait("title change", 20, || live.title() == "Artist B - Song 2");
    st.stop();
}

#[test]
fn aac_stream() {
    let srv = start_server();
    let mut st = plays(&format!("http://127.0.0.1:{}/aac", srv.port));
    st.stop();
}

#[test]
fn old_shoutcast_icy_reply() {
    let srv = start_server();
    let mut st = plays(&format!("http://127.0.0.1:{}/icy", srv.port));
    let live = Arc::clone(&st.live);
    wait("title", 10, || live.title() == "Artist A - Song 1");
    st.stop();
}

#[test]
fn redirect_and_php_link() {
    let srv = start_server();
    let mut a = plays(&format!("http://127.0.0.1:{}/redirect", srv.port));
    a.stop();
    let mut b = plays(&format!("http://127.0.0.1:{}/radio.php", srv.port));
    b.stop();
}

#[test]
fn pls_and_m3u_playlists() {
    let srv = start_server();
    let mut a = plays(&format!("http://127.0.0.1:{}/list.pls", srv.port));
    a.stop();
    let mut b = plays(&format!("http://127.0.0.1:{}/list.m3u", srv.port));
    b.stop();
}

#[test]
fn mid_stream_disconnect_reconnects() {
    let srv = start_server();
    let live = Arc::new(LiveBuffer::new(48_000));
    let mut st = Station::start(
        &format!("http://127.0.0.1:{}/drop", srv.port),
        Arc::clone(&live),
    );
    let mut saw_reconnecting = false;
    let started = Instant::now();
    // The first connection delivers ~1 s and dies; a reconnect brings much more.
    wait("audio after a reconnect", 20, || {
        if live.state().starts_with("reconnecting") {
            saw_reconnecting = true;
        }
        live.written() > 3 * 44_100
    });
    assert!(saw_reconnecting, "state went through reconnecting");
    assert!(started.elapsed() < Duration::from_secs(20));
    st.stop();
}

#[test]
fn a_web_page_is_explained_not_played() {
    let srv = start_server();
    let url = format!("http://127.0.0.1:{}/player.html", srv.port);
    assert_eq!(probe(&url), Err(RadioError::WebPage));
    let live = Arc::new(LiveBuffer::new(48_000));
    let mut st = Station::start(&url, Arc::clone(&live));
    wait("error state", 10, || live.state().starts_with("error"));
    assert!(
        live.state().contains("this is a web page, not a stream"),
        "{}",
        live.state()
    );
    // A permanent error is not retried: no audio, state stays.
    std::thread::sleep(Duration::from_millis(1500));
    assert!(live.state().starts_with("error"));
    assert_eq!(live.written(), 0);
    st.stop();
}

#[test]
fn hls_is_reported_as_not_supported_and_404_is_an_error() {
    let srv = start_server();
    assert_eq!(
        probe(&format!("http://127.0.0.1:{}/live.m3u8", srv.port)),
        Err(RadioError::Hls)
    );
    assert_eq!(
        probe(&format!("http://127.0.0.1:{}/nothing", srv.port)),
        Err(RadioError::Http(404))
    );
    assert!(probe("ftp://example.com/x").is_err());
    let ok = probe(&format!("http://127.0.0.1:{}/mp3", srv.port)).expect("probe");
    assert!(ok.contains("Test FM"), "{ok}");
}
