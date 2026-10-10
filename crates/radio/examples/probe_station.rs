//! Tries station addresses with the real radio code: connects, decodes a little audio and
//! prints what it found (or the error a user would see). Plays nothing.
//!
//!     cargo run -p radio --example probe_station -- <url> [<url> …]

fn main() {
    let urls: Vec<String> = std::env::args().skip(1).collect();
    if urls.is_empty() {
        eprintln!("usage: probe_station <url> [<url> …]");
        std::process::exit(2);
    }
    for url in urls {
        match radio::probe(&url) {
            Ok(desc) => println!("OK     {url}\n       {desc}"),
            Err(e) => println!("ERROR  {url}\n       {e}"),
        }
    }
}
