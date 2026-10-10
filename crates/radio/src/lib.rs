//! BongPlayer internet radio.
//!
//! `Station::start(url, live)` connects in the background and keeps a [`LiveBuffer`] filled:
//! - resolves `.pls` / `.m3u` playlists and HTTP redirects (e.g. a `radio.php` link);
//! - recognises a web page (HTML) and says so instead of failing silently;
//! - reads ICY song titles ("Artist - Title") from the stream;
//! - decodes MP3, AAC (ADTS) and Ogg Vorbis streams;
//! - reconnects with growing pauses (1, 2, 4, 8, 10 s) after a drop-out or a stall.

mod http;
mod icy;
mod playlist;

use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use engine::live::LiveBuffer;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::CodecParameters;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;

pub use playlist::{parse_m3u, parse_pls};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RadioError {
    BadUrl(String),
    Network(String),
    Http(u16),
    /// The address is a web page (player page), not an audio stream.
    WebPage,
    /// HLS (.m3u8 with segments) is not supported in this version.
    Hls,
    /// A playlist without any stream address in it.
    EmptyPlaylist,
    /// The stream is in a format we cannot decode.
    Unsupported(String),
}

impl std::fmt::Display for RadioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadUrl(u) => write!(f, "not a web address: {u}"),
            Self::Network(e) => write!(f, "network problem: {e}"),
            Self::Http(c) => write!(f, "the server answered with error {c}"),
            Self::WebPage => f.write_str(
                "this is a web page, not a stream — open it in a browser and look for the stream link (often ending in .mp3, .aac, .pls or .m3u)",
            ),
            Self::Hls => f.write_str("HLS streams (.m3u8 with segments) are not supported yet"),
            Self::EmptyPlaylist => f.write_str("the playlist contains no stream address"),
            Self::Unsupported(e) => write!(f, "cannot play this stream: {e}"),
        }
    }
}

impl std::error::Error for RadioError {}

impl RadioError {
    /// Errors that will not go away by reconnecting.
    pub fn is_permanent(&self) -> bool {
        matches!(
            self,
            Self::BadUrl(_)
                | Self::WebPage
                | Self::Hls
                | Self::EmptyPlaylist
                | Self::Unsupported(_)
        ) || matches!(self, Self::Http(c) if (400..500).contains(c))
    }
}

/// Looks at the start of a body to tell HTML and playlists from audio.
enum Kind {
    Html,
    Pls,
    M3u,
    Audio,
}

fn classify(content_type: Option<&str>, url: &str, head: &[u8]) -> Kind {
    let ct = content_type.unwrap_or("").to_ascii_lowercase();
    let text = String::from_utf8_lossy(&head[..head.len().min(512)]).to_ascii_lowercase();
    let t = text.trim_start_matches('\u{feff}').trim_start();
    if ct.contains("text/html") || t.starts_with("<!doctype html") || t.starts_with("<html") {
        return Kind::Html;
    }
    let path = url
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if ct.contains("scpls") || path.ends_with(".pls") || t.starts_with("[playlist]") {
        return Kind::Pls;
    }
    if ct.contains("mpegurl")
        || path.ends_with(".m3u")
        || path.ends_with(".m3u8")
        || t.starts_with("#extm3u")
    {
        return Kind::M3u;
    }
    Kind::Audio
}

/// Reads up to `n` bytes without consuming them from the caller's point of view: returns the
/// bytes and a reader that yields them again followed by the rest.
fn peek(
    mut body: Box<dyn Read + Send>,
    n: usize,
) -> std::io::Result<(Vec<u8>, Box<dyn Read + Send>)> {
    let mut head = vec![0u8; n];
    let mut got = 0;
    while got < n {
        let k = body.read(&mut head[got..])?;
        if k == 0 {
            break;
        }
        got += k;
    }
    head.truncate(got);
    let again = std::io::Cursor::new(head.clone()).chain(body);
    Ok((head, Box::new(again)))
}

/// An audio stream ready to decode.
pub struct OpenStream {
    pub url: String,
    pub content_type: Option<String>,
    pub name: Option<String>,
    icy_metaint: Option<usize>,
    body: Box<dyn Read + Send>,
}

/// Opens a station: follows redirects and playlists (up to 3 levels) until audio is found.
pub fn open(url: &str) -> Result<OpenStream, RadioError> {
    let mut url = url.trim().to_string();
    for _ in 0..4 {
        let resp = http::open(&url)?;
        let had_icy = resp.icy_metaint.is_some();
        let (head, body) = peek(resp.body, 4096).map_err(|e| RadioError::Network(e.to_string()))?;
        // ICY-formatted audio is audio even if the first bytes look odd.
        let kind = if had_icy {
            Kind::Audio
        } else {
            classify(resp.content_type.as_deref(), &resp.url, &head)
        };
        match kind {
            Kind::Html => return Err(RadioError::WebPage),
            Kind::Pls | Kind::M3u => {
                let mut all = head;
                let mut rest = body;
                let _ = rest.by_ref().take(64 * 1024).read_to_end(&mut all);
                let text = String::from_utf8_lossy(&all);
                let entries = if matches!(kind, Kind::Pls) {
                    parse_pls(&text)
                } else {
                    if text.contains("#EXT-X-") {
                        return Err(RadioError::Hls);
                    }
                    parse_m3u(&text)
                };
                let first = entries
                    .into_iter()
                    .next()
                    .ok_or(RadioError::EmptyPlaylist)?;
                url = http_join(&resp.url, &first);
            }
            Kind::Audio => {
                return Ok(OpenStream {
                    url: resp.url,
                    content_type: resp.content_type,
                    name: resp.icy_name,
                    icy_metaint: resp.icy_metaint,
                    body,
                });
            }
        }
    }
    Err(RadioError::Network("too many playlist levels".into()))
}

fn http_join(base: &str, entry: &str) -> String {
    if entry.contains("://") {
        entry.to_string()
    } else if let Some(i) = base.rfind('/') {
        format!("{}{}", &base[..=i], entry.trim_start_matches('/'))
    } else {
        entry.to_string()
    }
}

fn hint_for(content_type: Option<&str>, url: &str) -> Hint {
    let mut hint = Hint::new();
    let ct = content_type.unwrap_or("").to_ascii_lowercase();
    let ext = if ct.contains("aac") {
        Some("aac")
    } else if ct.contains("mpeg") || ct.contains("mp3") {
        Some("mp3")
    } else if ct.contains("ogg") {
        Some("ogg")
    } else {
        url.rsplit('.').next().filter(|e| e.len() <= 4)
    };
    if let Some(e) = ext {
        hint.with_extension(e);
    }
    hint
}

pub use runner::Station;

mod runner {
    use super::*;

    /// A station playing into a live buffer, reconnecting on its own until stopped.
    pub struct Station {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
        pub live: Arc<LiveBuffer>,
    }

    impl Station {
        pub fn start(url: &str, live: Arc<LiveBuffer>) -> Self {
            let stop = Arc::new(AtomicBool::new(false));
            let s = Arc::clone(&stop);
            let l = Arc::clone(&live);
            let url = url.to_string();
            let thread = std::thread::Builder::new()
                .name("bong-radio".into())
                .spawn(move || supervise(&url, &l, &s))
                .ok();
            if thread.is_none() {
                live.set_state("error: could not start the radio thread");
            }
            Self { stop, thread, live }
        }

        pub fn stop(&mut self) {
            self.stop.store(true, Ordering::Release);
            self.live.close();
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    impl Drop for Station {
        fn drop(&mut self) {
            self.stop();
        }
    }

    /// Gives up on a connection that delivers no audio for this long.
    pub const STALL: Duration = Duration::from_secs(15);
    const BACKOFF: [u64; 5] = [1, 2, 4, 8, 10];

    fn sleep_unless_stopped(stop: &AtomicBool, secs: u64) {
        let until = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < until && !stop.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn supervise(url: &str, live: &Arc<LiveBuffer>, stop: &Arc<AtomicBool>) {
        // Each connection runs in its own thread with a generation number. A connection that
        // hangs (e.g. an HTTPS read that never returns) is abandoned: its later writes are
        // ignored and a new connection starts.
        let generation = Arc::new(AtomicU64::new(0));
        let mut attempt = 0usize;
        while !stop.load(Ordering::Acquire) {
            let gen = generation.fetch_add(1, Ordering::AcqRel) + 1;
            live.set_state(if attempt == 0 {
                "connecting"
            } else {
                "reconnecting"
            });
            let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<(), RadioError>>();
            {
                let (url, conn_live, stop, generation) = (
                    url.to_string(),
                    Arc::clone(live),
                    Arc::clone(stop),
                    Arc::clone(&generation),
                );
                let spawned = std::thread::Builder::new()
                    .name("bong-radio-conn".into())
                    .spawn(move || {
                        let keep_going = || {
                            !stop.load(Ordering::Acquire)
                                && generation.load(Ordering::Acquire) == gen
                        };
                        let r = open(&url).and_then(|s| decode_into(s, &conn_live, &keep_going));
                        let _ = done_tx.send(r);
                    });
                if spawned.is_err() {
                    live.set_state("error: could not start a connection");
                    return;
                }
            }
            // Watch the connection: finished, or no new audio for STALL.
            let mut last_written = live.written();
            let mut last_progress = Instant::now();
            let result = loop {
                if stop.load(Ordering::Acquire) {
                    return;
                }
                match done_rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(r) => break r,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        break Err(RadioError::Network("connection ended".into()))
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                }
                let w = live.written();
                if w != last_written {
                    last_written = w;
                    last_progress = Instant::now();
                    attempt = 0;
                } else if last_progress.elapsed() >= STALL {
                    break Err(RadioError::Network(format!(
                        "no audio for {} s",
                        STALL.as_secs()
                    )));
                }
            };
            if stop.load(Ordering::Acquire) {
                return;
            }
            match result {
                Err(e) if e.is_permanent() => {
                    live.set_state(&format!("error: {e}"));
                    return;
                }
                other => {
                    let why = match other {
                        Ok(()) => "the stream ended".to_string(),
                        Err(e) => e.to_string(),
                    };
                    let wait = BACKOFF[attempt.min(BACKOFF.len() - 1)];
                    attempt += 1;
                    live.set_state(&format!("reconnecting in {wait} s ({why})"));
                    sleep_unless_stopped(stop, wait);
                }
            }
        }
    }
}

/// Decodes `stream` into `live` while `keep_going()`; Ok(()) when the stream ends.
pub fn decode_into(
    stream: OpenStream,
    live: &Arc<LiveBuffer>,
    keep_going: &dyn Fn() -> bool,
) -> Result<(), RadioError> {
    let hint = hint_for(stream.content_type.as_deref(), &stream.url);
    let titles = Arc::clone(live);
    let reader = icy::IcyReader::new(
        stream.body,
        stream.icy_metaint,
        Box::new(move |t: String| titles.set_title(&t)),
    );
    let source = ReadOnlySource::new(http::SyncReader::new(Box::new(reader)));
    let mss = MediaSourceStream::new(Box::new(source), Default::default());
    let mut reader = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| RadioError::Unsupported(e.to_string()))?;
    let track = reader
        .default_track(TrackType::Audio)
        .ok_or_else(|| RadioError::Unsupported("no audio in the stream".into()))?
        .clone();
    let Some(CodecParameters::Audio(params)) = track.codec_params.clone() else {
        return Err(RadioError::Unsupported("no audio in the stream".into()));
    };
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| RadioError::Unsupported(e.to_string()))?;
    if let Some(rate) = params.sample_rate {
        if live.written() == 0 {
            live.set_sample_rate(rate);
        }
    }
    if let Some(name) = &stream.name {
        if live.title().is_empty() {
            live.set_title(name);
        }
    }
    live.set_state("playing");
    let mut interleaved: Vec<f32> = Vec::new();
    let mut stereo: Vec<f32> = Vec::new();
    let mut bad = 0u32;
    while keep_going() {
        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => return Ok(()),
            Err(SymphoniaError::IoError(e)) => {
                return if e.kind() == std::io::ErrorKind::UnexpectedEof {
                    Ok(())
                } else {
                    Err(RadioError::Network(e.to_string()))
                }
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => return Err(RadioError::Network(e.to_string())),
        };
        if packet.track_id != track.id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(b) => b,
            Err(SymphoniaError::DecodeError(_)) => {
                bad += 1;
                if bad > 200 {
                    return Err(RadioError::Unsupported("too many damaged packets".into()));
                }
                continue;
            }
            Err(e) => return Err(RadioError::Unsupported(e.to_string())),
        };
        bad = 0;
        let ch = decoded.spec().channels().count().max(1);
        let rate = decoded.spec().rate();
        if live.written() == 0 && rate != live.sample_rate() {
            live.set_sample_rate(rate);
        }
        decoded.copy_to_vec_interleaved(&mut interleaved);
        stereo.clear();
        for f in interleaved.chunks_exact(ch) {
            let (l, r) = match f {
                [m] => (*m, *m),
                [l, r, ..] => (*l, *r),
                [] => (0.0, 0.0),
            };
            stereo.push(l);
            stereo.push(r);
        }
        if !keep_going() {
            break;
        }
        live.push(&stereo);
    }
    Ok(())
}

/// Connects, checks that audio can be decoded, and returns the stream's name / format.
/// Used to test a station before saving it.
pub fn probe(url: &str) -> Result<String, RadioError> {
    let s = open(url)?;
    let desc = format!(
        "{}{}",
        s.name.clone().unwrap_or_else(|| "stream".into()),
        s.content_type
            .as_deref()
            .map(|c| format!(" ({c})"))
            .unwrap_or_default()
    );
    let live = Arc::new(LiveBuffer::new(48_000));
    let started = Instant::now();
    let l2 = Arc::clone(&live);
    let keep = move || l2.written() < 4_800 && started.elapsed() < Duration::from_secs(10);
    decode_into(s, &live, &keep)?;
    if live.written() == 0 {
        return Err(RadioError::Network("no audio arrived".into()));
    }
    Ok(desc)
}
