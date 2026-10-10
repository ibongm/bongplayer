//! Headphone-cue spike (PLAN M2): can BongPlayer reach the DDJ-400 headphone jack through
//! normal Windows audio (WASAPI)?
//!
//!     cargo run --release -p engine --example channel_test -- <device id>
//!
//! Get the device id from `play_file -- --devices`. The program prints how many channels the
//! device has, then alternates, three times:
//! - a LOW tone (440 Hz) on channels 1–2 for 2 seconds (normally the master / speakers),
//! - a HIGH tone (880 Hz) on channels 3–4 for 2 seconds (on the DDJ-400: the headphones).
//!
//! Listen on the speakers AND the headphones and note which tone comes out where.

use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

fn main() {
    let Some(wanted) = std::env::args().nth(1) else {
        eprintln!("usage: channel_test <device id>   (ids: play_file -- --devices)");
        std::process::exit(2);
    };
    let host = cpal::default_host();
    let device = host.output_devices().ok().and_then(|mut it| {
        it.find(|d| d.id().ok().map(|id| id.to_string()).as_deref() == Some(wanted.as_str()))
    });
    let Some(device) = device else {
        eprintln!("device not found: {wanted}");
        std::process::exit(1);
    };
    let name = device
        .description()
        .map(|d| d.to_string())
        .unwrap_or_default();
    let config = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{name}: {e}");
            std::process::exit(1);
        }
    };
    if config.sample_format() != cpal::SampleFormat::F32 {
        eprintln!(
            "{name}: sample format {} not supported by this test",
            config.sample_format()
        );
        std::process::exit(1);
    }
    let channels = usize::from(config.channels());
    let rate = config.sample_rate() as f32;
    println!("{name}: {channels} channels at {rate} Hz");
    if channels < 4 {
        println!("Only {channels} channels: channels 3–4 do not exist on this device via WASAPI.");
    }

    let started = std::time::Instant::now();
    let mut n: u64 = 0;
    let stream = device.build_output_stream::<f32, _, _>(
        config.config(),
        move |data: &mut [f32], _| {
            for frame in data.chunks_mut(channels) {
                let t = started.elapsed().as_secs_f32();
                let phase = n as f32 / rate;
                n += 1;
                let second_pair = (t as u64 / 2) % 2 == 1;
                let freq = if second_pair { 880.0 } else { 440.0 };
                let v = 0.2 * (2.0 * std::f32::consts::PI * freq * phase).sin();
                for (c, s) in frame.iter_mut().enumerate() {
                    let on = if second_pair { c == 2 || c == 3 } else { c < 2 };
                    *s = if on { v } else { 0.0 };
                }
            }
        },
        |e| eprintln!("stream error: {e}"),
        None,
    );
    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{name}: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = stream.play() {
        eprintln!("{name}: {e}");
        std::process::exit(1);
    }
    for round in 1..=3 {
        println!("round {round}: LOW tone on channels 1-2 ...");
        std::thread::sleep(Duration::from_secs(2));
        println!("round {round}: HIGH tone on channels 3-4 ...");
        std::thread::sleep(Duration::from_secs(2));
    }
    println!("done");
}
