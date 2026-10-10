//! M1 acceptance: crossfader is constant-power (A² + B² = 1 across the travel);
//! limiter never exceeds its ceiling on a clipping test signal.

use engine::limiter::Limiter;
use engine::mixer::{crossfader_gains, Mixer};

const SR: u32 = 48_000;

#[test]
fn crossfader_is_constant_power_at_101_positions() {
    for i in 0..=100 {
        let x = i as f32 / 100.0;
        let (a, b) = crossfader_gains(x);
        let power = a * a + b * b;
        assert!((power - 1.0).abs() <= 1e-6, "position {x}: a²+b² = {power}");
    }
    assert_eq!(crossfader_gains(0.0), (1.0, 0.0));
    let (a, b) = crossfader_gains(1.0);
    assert!(a.abs() < 1e-6 && (b - 1.0).abs() < 1e-6);
}

/// RMS of the left channel, skipping the first `skip` frames.
fn rms(buf: &[f32], skip: usize) -> f64 {
    let v: Vec<f64> = buf
        .iter()
        .step_by(2)
        .skip(skip)
        .map(|&s| f64::from(s))
        .collect();
    (v.iter().map(|s| s * s).sum::<f64>() / v.len() as f64).sqrt()
}

#[test]
fn mixer_output_power_follows_the_crossfader_law() {
    let frames = 4_800;
    let sine: Vec<f32> = (0..frames)
        .flat_map(|n| {
            // 480 Hz = exactly 100 samples per cycle, so RMS windows hold whole cycles.
            let s = 0.25 * (2.0 * std::f32::consts::PI * 480.0 * n as f32 / SR as f32).sin();
            [s, s]
        })
        .collect();
    let silence = vec![0.0f32; 2 * frames];
    let reference = rms(&sine, 0);

    for i in 0..=10 {
        let x = i as f32 / 10.0;
        let level = |a_in: &[f32], b_in: &[f32]| {
            let mut m = Mixer::new(SR);
            m.set_crossfader(x);
            m.snap();
            let (mut a, mut b) = (a_in.to_vec(), b_in.to_vec());
            let mut out = vec![0.0f32; 2 * frames];
            m.process(&mut a, &mut b, &mut out);
            rms(&out, 1_000) / reference
        };
        let ga = level(&sine, &silence);
        let gb = level(&silence, &sine);
        let power = ga * ga + gb * gb;
        assert!(
            (power - 1.0).abs() < 1e-3,
            "position {x}: measured a²+b² = {power:.5}"
        );
    }
}

/// Deterministic white noise (xorshift), uniform in [-amp, amp].
fn noise(frames: usize, amp: f32) -> Vec<f32> {
    let mut s: u32 = 0x1234_5678;
    (0..2 * frames)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            (s as f32 / u32::MAX as f32 * 2.0 - 1.0) * amp
        })
        .collect()
}

fn loud_signals() -> Vec<(&'static str, Vec<f32>)> {
    let frames = SR as usize; // 1 s
    let amp = 4.0; // +12 dB over full scale
    let sine = (0..frames)
        .flat_map(|n| {
            let s = amp * (2.0 * std::f32::consts::PI * 997.0 * n as f32 / SR as f32).sin();
            [s, -s]
        })
        .collect();
    let square = (0..frames)
        .flat_map(|n| {
            let s = if (n / 24) % 2 == 0 { amp } else { -amp };
            [s, s]
        })
        .collect();
    // Silence, then a sudden full blast: the hardest case for the attack.
    let step = (0..frames)
        .flat_map(|n| {
            let s = if n < frames / 2 { 0.0 } else { amp };
            [s, s]
        })
        .collect();
    // Isolated single-sample spikes on a quiet bed.
    let spikes = (0..frames)
        .flat_map(|n| {
            let s = if n % 5_000 == 0 { 8.0 } else { 0.05 };
            [s, -s]
        })
        .collect();
    vec![
        ("sine +12 dB", sine),
        ("square +12 dB", square),
        ("noise +12 dB", noise(frames, amp)),
        ("silence to +12 dB step", step),
        ("single-sample spikes +18 dB", spikes),
    ]
}

#[test]
fn limiter_never_exceeds_the_ceiling() {
    for ceiling_db in [-1.0f32, -0.1, -6.0] {
        for (name, signal) in loud_signals() {
            let mut lim = Limiter::new(SR);
            lim.set_ceiling_db(ceiling_db);
            let ceiling = lim.ceiling();
            let mut buf = signal;
            for block in buf.chunks_mut(2 * 256) {
                lim.process(block);
            }
            let peak = buf.iter().fold(0.0f32, |m, s| m.max(s.abs()));
            println!(
                "{name} @ {ceiling_db} dB: peak {:.4} dBFS",
                20.0 * peak.log10()
            );
            assert!(
                peak <= ceiling,
                "{name} @ {ceiling_db} dB: peak {peak} > {ceiling}"
            );
        }
    }
}

#[test]
fn limited_loud_sine_still_reaches_close_to_the_ceiling() {
    let (_, sine) = loud_signals().swap_remove(0);
    let mut lim = Limiter::new(SR);
    let mut buf = sine;
    lim.process(&mut buf);
    let tail = &buf[buf.len() / 2..];
    let peak = tail.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(peak >= lim.ceiling() * 0.9, "over-limited: peak {peak}");
}

#[test]
fn full_mixer_with_master_boost_stays_under_ceiling() {
    let (_, sine) = loud_signals().swap_remove(0);
    let mut m = Mixer::new(SR);
    m.set_master_db(6.0);
    m.set_crossfader(0.5);
    m.snap();
    let mut a = sine.clone();
    let mut b = sine;
    let mut out = vec![0.0f32; a.len()];
    m.process(&mut a, &mut b, &mut out);
    let peak = out.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));
    assert!(peak <= m.limiter.ceiling(), "peak {peak}");
}
