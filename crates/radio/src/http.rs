//! Opening a station URL: plain HTTP with our own small client (it also accepts old
//! SHOUTcast "ICY 200 OK" replies and sets socket timeouts), HTTPS through `ureq` with
//! rustls, checking certificates against the Windows certificate store. Redirects are followed
//! in both cases.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;

use crate::RadioError;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: usize = 6;
const USER_AGENT: &str = concat!("BongPlayer/", env!("CARGO_PKG_VERSION"));

/// An open response: headers we care about and a body reader.
pub struct Response {
    pub content_type: Option<String>,
    /// Bytes of audio between ICY metadata blocks, if the server sends titles.
    pub icy_metaint: Option<usize>,
    pub icy_name: Option<String>,
    /// URL after redirects.
    pub url: String,
    pub body: Box<dyn Read + Send>,
}

/// Wraps a reader so it is `Sync` (needed by the decoder), by putting it behind a mutex.
pub struct SyncReader(Mutex<Box<dyn Read + Send>>);

impl SyncReader {
    pub fn new(r: Box<dyn Read + Send>) -> Self {
        Self(Mutex::new(r))
    }
}

impl Read for SyncReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self.0.get_mut() {
            Ok(r) => r.read(buf),
            Err(poisoned) => poisoned.into_inner().read(buf),
        }
    }
}

struct Url<'a> {
    host: &'a str,
    port: u16,
    path: &'a str,
}

fn parse_http(url: &str) -> Result<Url<'_>, RadioError> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| RadioError::BadUrl(url.to_string()))?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) if !h.contains(']') || h.ends_with(']') => (
            h,
            p.parse::<u16>()
                .map_err(|_| RadioError::BadUrl(url.to_string()))?,
        ),
        _ => (hostport, 80),
    };
    if host.is_empty() {
        return Err(RadioError::BadUrl(url.to_string()));
    }
    Ok(Url { host, port, path })
}

/// Joins a redirect target onto the current URL.
fn join(base: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    let scheme_end = base.find("://").map_or(0, |i| i + 3);
    let host_end = base[scheme_end..]
        .find('/')
        .map_or(base.len(), |i| scheme_end + i);
    if let Some(stripped) = location.strip_prefix("//") {
        let scheme = &base[..scheme_end];
        return format!("{scheme}{stripped}");
    }
    if location.starts_with('/') {
        return format!("{}{location}", &base[..host_end]);
    }
    let dir_end = base
        .rfind('/')
        .filter(|&i| i >= host_end)
        .map_or(base.len(), |i| i + 1);
    format!("{}{location}", &base[..dir_end.max(host_end)])
}

fn open_http(url: &str) -> Result<Result<Response, String>, RadioError> {
    let u = parse_http(url)?;
    let addr = (u.host, u.port)
        .to_socket_addrs()
        .map_err(|e| RadioError::Network(format!("{}: {e}", u.host)))?
        .next()
        .ok_or_else(|| RadioError::Network(format!("{}: no address", u.host)))?;
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| RadioError::Network(format!("{}: {e}", u.host)))?;
    stream
        .set_read_timeout(Some(READ_TIMEOUT))
        .map_err(|e| RadioError::Network(e.to_string()))?;
    let host_header = if u.port == 80 {
        u.host.to_string()
    } else {
        format!("{}:{}", u.host, u.port)
    };
    // HTTP/1.0 avoids chunked transfer encoding on endless streams.
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: {host_header}\r\nUser-Agent: {USER_AGENT}\r\nIcy-MetaData: 1\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        u.path
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| RadioError::Network(e.to_string()))?;
    let mut reader = BufReader::new(stream);
    let mut status = String::new();
    reader
        .read_line(&mut status)
        .map_err(|e| RadioError::Network(format!("no reply: {e}")))?;
    let code: u16 = status
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| RadioError::Network(format!("not an HTTP reply: {}", status.trim())))?;
    let mut headers: Vec<(String, String)> = Vec::new();
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| RadioError::Network(e.to_string()))?;
        let line = line.trim_end();
        if n == 0 || line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
        if headers.len() > 100 {
            break;
        }
    }
    let header = |k: &str| headers.iter().find(|(h, _)| h == k).map(|(_, v)| v.clone());
    if (300..400).contains(&code) {
        let loc = header("location")
            .ok_or_else(|| RadioError::Network(format!("redirect {code} without a target")))?;
        return Ok(Err(join(url, &loc)));
    }
    if code >= 400 {
        return Err(RadioError::Http(code));
    }
    Ok(Ok(Response {
        content_type: header("content-type"),
        icy_metaint: header("icy-metaint").and_then(|v| v.parse().ok()),
        icy_name: header("icy-name"),
        url: url.to_string(),
        body: Box::new(reader),
    }))
}

fn open_https(url: &str) -> Result<Response, RadioError> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::Rustls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .max_redirects(MAX_REDIRECTS as u32)
        .user_agent(USER_AGENT)
        .build()
        .into();
    let resp = agent
        .get(url)
        .header("Icy-MetaData", "1")
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(c) => RadioError::Http(c),
            other => RadioError::Network(other.to_string()),
        })?;
    let h = |k: &str| {
        resp.headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let content_type = h("content-type");
    let icy_metaint = h("icy-metaint").and_then(|v| v.parse().ok());
    let icy_name = h("icy-name");
    let body = resp.into_body().into_reader();
    Ok(Response {
        content_type,
        icy_metaint,
        icy_name,
        url: url.to_string(),
        body: Box::new(body),
    })
}

/// Opens a URL, following redirects.
pub fn open(url: &str) -> Result<Response, RadioError> {
    let mut current = url.trim().to_string();
    for _ in 0..=MAX_REDIRECTS {
        let lower = current.to_ascii_lowercase();
        if lower.starts_with("https://") {
            return open_https(&current);
        }
        if !lower.starts_with("http://") {
            return Err(RadioError::BadUrl(current));
        }
        match open_http(&current)? {
            Ok(resp) => return Ok(resp),
            Err(next) => current = next,
        }
    }
    Err(RadioError::Network("too many redirects".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_and_redirect_targets() {
        let u = parse_http("http://live.radiodalmacija.hr/radio.php").expect("url");
        assert_eq!(
            (u.host, u.port, u.path),
            ("live.radiodalmacija.hr", 80, "/radio.php")
        );
        let u = parse_http("http://1.2.3.4:8000").expect("url");
        assert_eq!((u.host, u.port, u.path), ("1.2.3.4", 8000, "/"));
        assert!(parse_http("ftp://x").is_err());
        assert_eq!(
            join("http://a.com/x/radio.php", "/live.mp3"),
            "http://a.com/live.mp3"
        );
        assert_eq!(
            join("http://a.com/x/radio.php", "live.mp3"),
            "http://a.com/x/live.mp3"
        );
        assert_eq!(join("http://a.com/x", "https://b.com/s"), "https://b.com/s");
        assert_eq!(join("https://a.com/x", "//c.com/s"), "https://c.com/s");
    }
}
