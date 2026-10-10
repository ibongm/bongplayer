//! Writes a synthetic test song (known BPM and key) as a 32-bit float WAV.
//! Used by `tests/fixtures/make_fixtures.ps1` to build the analysis benchmark files.
//!
//!     cargo run -p library --example make_song -- <out.wav> <bpm> <tonic 0-11> <major|minor> <seconds>

#[allow(dead_code)]
#[path = "../tests/common/synth.rs"]
mod synth;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 5 {
        eprintln!("usage: make_song <out.wav> <bpm> <tonic 0-11> <major|minor> <seconds>");
        std::process::exit(2);
    }
    let parse = |i: usize| -> f64 {
        args[i].parse().unwrap_or_else(|_| {
            eprintln!("not a number: {}", args[i]);
            std::process::exit(2)
        })
    };
    let song = synth::Song {
        bpm: parse(1),
        tonic: (parse(2) as i64).rem_euclid(12) as u8,
        minor: args[3] == "minor",
        seconds: parse(4),
        rate: 44_100,
    };
    let samples = synth::render(&song);
    if let Err(e) = engine::offline::write_wav(std::path::Path::new(&args[0]), song.rate, &samples)
    {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
