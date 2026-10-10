//! M1 acceptance: 3-band EQ response within 0.5 dB of spec; kills reach ≤ −60 dB.
//!
//! Spec: isolator with crossovers at 300 Hz and 4 kHz; band gains −∞ … +6 dB.
//! Measured at each band's centre: low 60 Hz, mid 1.1 kHz, high 12 kHz.

use engine::eq::{Band, ThreeBandEq};
use engine::strip::ChannelStrip;

const SR: u32 = 48_000;

/// Steady-state gain in dB of `process` for a sine at `freq`.
fn response_db(freq: f64, mut process: impl FnMut(&mut [f32])) -> f64 {
    let total = (SR as f64 * 1.0) as usize; // 1 s: long enough to settle at 20 Hz
    let measure_from = total / 2;
    let mut buf = vec![0.0f32; 2 * 512];
    let (mut in_sq, mut out_sq) = (0.0f64, 0.0f64);
    let mut n = 0usize;
    while n < total {
        let frames = (total - n).min(512);
        for i in 0..frames {
            let s =
                0.5 * (2.0 * std::f64::consts::PI * freq * (n + i) as f64 / f64::from(SR)).sin();
            buf[2 * i] = s as f32;
            buf[2 * i + 1] = s as f32;
        }
        let input: Vec<f32> = buf[..2 * frames].to_vec();
        process(&mut buf[..2 * frames]);
        for i in 0..frames {
            if n + i >= measure_from {
                in_sq += f64::from(input[2 * i]).powi(2);
                out_sq += f64::from(buf[2 * i]).powi(2);
            }
        }
        n += frames;
    }
    10.0 * (out_sq / in_sq).log10()
}

fn eq_with(setup: impl FnOnce(&mut ThreeBandEq)) -> ThreeBandEq {
    let mut eq = ThreeBandEq::new(SR);
    setup(&mut eq);
    eq.snap();
    eq
}

const CENTRES: [(Band, f64); 3] = [
    (Band::Low, 60.0),
    (Band::Mid, 1_100.0),
    (Band::High, 12_000.0),
];

#[test]
fn flat_at_0_db_from_20_hz_to_20_khz() {
    let mut worst = 0.0f64;
    // 1/3-octave steps from 20 Hz to 20 kHz.
    let mut f = 20.0;
    while f <= 20_000.0 {
        let mut eq = eq_with(|_| {});
        let db = response_db(f, |b| eq.process(b));
        assert!(db.abs() <= 0.5, "{f:.0} Hz: {db:+.3} dB");
        worst = worst.max(db.abs());
        f *= 2f64.powf(1.0 / 3.0);
    }
    println!("flat response: worst deviation {worst:.4} dB");
}

#[test]
fn each_band_boost_and_cut_6_db_at_its_centre() {
    for (band, freq) in CENTRES {
        for target in [6.0f32, -6.0] {
            let mut eq = eq_with(|e| e.set_gain_db(band, target));
            let db = response_db(freq, |b| eq.process(b));
            println!("{band:?} {target:+} dB at {freq} Hz: {db:+.3} dB");
            assert!(
                (db - f64::from(target)).abs() <= 0.5,
                "{band:?} {target:+} dB at {freq} Hz measured {db:+.3} dB"
            );
        }
    }
}

#[test]
fn kills_reach_minus_60_db_at_band_centre() {
    for (band, freq) in CENTRES {
        let mut eq = eq_with(|e| e.set_kill(band, true));
        let db = response_db(freq, |b| eq.process(b));
        println!("{band:?} kill at {freq} Hz: {db:.1} dB");
        assert!(db <= -60.0, "{band:?} kill at {freq} Hz only {db:.1} dB");
    }
}

#[test]
fn killing_one_band_leaves_the_others() {
    let mut eq = eq_with(|e| e.set_kill(Band::Low, true));
    let db = response_db(1_100.0, |b| eq.process(b));
    assert!(db.abs() <= 0.5, "mid with low killed: {db:+.3} dB");
}

#[test]
fn boost_is_capped_at_6_db() {
    let eq = eq_with(|e| e.set_gain_db(Band::High, 20.0));
    assert_eq!(eq.gain_db(Band::High), 6.0);
}

#[test]
fn strip_trim_and_fader() {
    let mut strip = ChannelStrip::new(SR);
    strip.set_trim_db(-6.0);
    strip.set_fader(0.5);
    strip.snap();
    let db = response_db(1_000.0, |b| strip.process(b));
    // −6 dB trim, fader 0.5 (−6.02 dB).
    assert!((db - (-12.02)).abs() <= 0.1, "trim+fader: {db:+.3} dB");

    strip.set_fader(0.0);
    strip.snap();
    let db = response_db(1_000.0, |b| strip.process(b));
    assert!(db < -120.0, "closed fader: {db} dB");
}
