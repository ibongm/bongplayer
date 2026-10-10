//! Synthetic test music with a known tempo and key: kick on every beat, snare on 2 and 4,
//! closed hi-hat on the off-beats, a bass note and a sustained triad per bar following a
//! typical progression. Deterministic (fixed noise seed).

use std::f64::consts::PI;

pub struct Song {
    pub bpm: f64,
    /// Tonic pitch class, 0 = C.
    pub tonic: u8,
    pub minor: bool,
    pub seconds: f64,
    pub rate: u32,
}

fn midi_hz(m: f64) -> f64 {
    440.0 * 2f64.powf((m - 69.0) / 12.0)
}

/// Stereo interleaved samples.
pub fn render(song: &Song) -> Vec<f32> {
    let rate = f64::from(song.rate);
    let frames = (song.seconds * rate) as usize;
    let beat = 60.0 / song.bpm;
    let bar = 4.0 * beat;
    // Chord roots in semitones above the tonic, one per bar.
    // i – iv – V – i (harmonic minor) or I – IV – V – I: unambiguous cadences.
    let prog: [i32; 4] = [0, 5, 7, 0];
    // Chord quality per degree (true = minor triad).
    let quality = |root: i32| -> bool { song.minor && root != 7 };
    let mut noise_state: u32 = 0x9E37_79B9;
    let mut noise = move || {
        noise_state ^= noise_state << 13;
        noise_state ^= noise_state >> 17;
        noise_state ^= noise_state << 5;
        f64::from(noise_state) / f64::from(u32::MAX) * 2.0 - 1.0
    };
    let mut prev_noise = 0.0;
    let mut out = Vec::with_capacity(frames * 2);
    for n in 0..frames {
        let t = n as f64 / rate;
        let tb = t % beat; // time since beat
        let beat_index = (t / beat) as i64;
        let bar_index = (t / bar) as usize;
        let mut s = 0.0;

        // Kick: pitch drop 110 → 45 Hz, 0.18 s decay.
        let kick_phase = 2.0 * PI * (45.0 * tb + 65.0 * 0.03 * (1.0 - (-tb / 0.03).exp()));
        s += 0.7 * (-tb / 0.12).exp() * kick_phase.sin();

        // Snare on beats 2 and 4: noise burst.
        let nz = noise();
        if beat_index % 2 == 1 {
            s += 0.25 * (-tb / 0.06).exp() * nz;
        }
        // Hi-hat on the off-beat: high-passed noise.
        let off = (t + beat / 2.0) % beat;
        let hp = nz - prev_noise;
        prev_noise = nz;
        s += 0.08 * (-off / 0.02).exp() * hp;

        // Harmony.
        let root = prog[bar_index % 4];
        let minor_chord = quality(root);
        let base = 48.0 + f64::from(song.tonic) + f64::from(root); // C3 + offset
        let bass = 36.0 + f64::from(song.tonic) + f64::from(root);
        let notes = [
            base,
            base + if minor_chord { 3.0 } else { 4.0 },
            base + 7.0,
            base + 12.0,
        ];
        for m in notes {
            let f = midi_hz(m);
            s += 0.05 * ((2.0 * PI * f * t).sin() + 0.3 * (4.0 * PI * f * t).sin());
        }
        s += 0.12 * (2.0 * PI * midi_hz(bass) * t).sin();

        let v = (s * 0.8) as f32;
        out.push(v);
        out.push(v);
    }
    out
}

/// Mono version of `render`.
pub fn render_mono(song: &Song) -> Vec<f32> {
    render(song).as_chunks::<2>().0.iter().map(|c| c[0]).collect()
}
