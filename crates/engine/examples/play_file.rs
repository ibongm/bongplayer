//! Plays one file on deck A through the default sound card — a manual check of the real output.
//!
//!     cargo run --release -p engine --example play_file -- "C:\Music\song.mp3"
//!
//! While it plays, unplug/replug the output device: playback should continue on the new default
//! device. Stop with Ctrl+C.
//!
//!     cargo run --release -p engine --example play_file -- --devices
//!         lists the output devices and their ids
//!     cargo run --release -p engine --example play_file -- --prefer <device id> <audio file>
//!         plays on that device whenever it is plugged in, the default device otherwise

use std::path::PathBuf;
use std::time::Duration;

use engine::cpal_backend::CpalBackend;
use engine::output::{AudioBackend, OutputSupervisor};
use engine::{new_engine, start_decoding, Command, DeckId};

fn main() {
    let mut args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|a| a == "--devices") {
        for d in CpalBackend.devices() {
            let default = if d.is_default { "  (default)" } else { "" };
            println!(
                "{}{default}
    id: {}",
                d.name, d.id
            );
        }
        return;
    }
    let mut preferred = None;
    if args.first().is_some_and(|a| a == "--prefer") && args.len() >= 2 {
        preferred = Some(args[1].to_string_lossy().into_owned());
        args.drain(..2);
    }
    let Some(path) = args.first().map(PathBuf::from) else {
        eprintln!("usage: play_file [--devices | --prefer <device id>] <audio file>");
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

    let output = match OutputSupervisor::start(CpalBackend, engine, preferred) {
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
            "{:>3}:{:04.1}  output {} Hz  {}  reopened {}x  on {}",
            (secs / 60.0) as u64,
            secs % 60.0,
            status.sample_rate(),
            if output.state().is_running() {
                "playing"
            } else {
                "NO OUTPUT"
            },
            output.state().reopens(),
            output
                .state()
                .current_device()
                .map_or_else(|| "-".to_string(), |d| d.name),
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
