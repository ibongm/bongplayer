//! Plays one file on deck A through the default sound card — a manual check of the real output.
//!
//!     cargo run --release -p engine --example play_file -- "C:\Music\song.mp3"
//!
//! While it plays, unplug/replug the output device: playback should continue on the new default
//! device. Stop with Ctrl+C.

use std::path::PathBuf;
use std::time::Duration;

use engine::cpal_backend::CpalBackend;
use engine::output::OutputSupervisor;
use engine::{new_engine, start_decoding, Command, DeckId};

fn main() {
    let Some(path) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: play_file <audio file>");
        std::process::exit(2);
    };
    let track = match start_decoding(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let file_rate = track.buffer.sample_rate();
    println!(
        "{} — {file_rate} Hz, {} channel(s)",
        path.display(),
        track.channels
    );

    let (mut handle, engine) = new_engine(48_000);
    let commands = [Command::SetCrossfader(0.0), Command::Play(DeckId::A)];
    if let Err(e) = handle
        .load(DeckId::A, track.buffer)
        .and_then(|()| commands.into_iter().try_for_each(|c| handle.send(c)))
    {
        eprintln!("{e}");
        std::process::exit(1);
    }

    let output = match OutputSupervisor::start(CpalBackend, engine) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("cannot start output: {e}");
            std::process::exit(1);
        }
    };

    let mut last_problem = None;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        handle.collect_garbage();
        let status = handle.status();
        let deck = status.deck(DeckId::A);
        let secs = deck.position() / f64::from(file_rate);
        println!(
            "{:>3}:{:04.1}  output {} Hz  {}  reopened {}x",
            (secs / 60.0) as u64,
            secs % 60.0,
            status.sample_rate(),
            if output.state().is_running() {
                "playing"
            } else {
                "NO OUTPUT"
            },
            output.state().reopens(),
        );
        let problem = output.state().last_problem();
        if problem != last_problem {
            if let Some(p) = &problem {
                println!("    note: {p}");
            }
            last_problem = problem;
        }
        if deck.has_ended() {
            println!("end of track");
            break;
        }
    }
    drop(output.stop());
}
