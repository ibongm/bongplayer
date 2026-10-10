//! M11 (app): the DDJ-400 profile. Raw MIDI bytes as the controller sends them are decoded,
//! applied to the real engine (rendered offline), and the LEDs follow. No hardware is used.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use bongplayer_lib::commands::BandName;
use bongplayer_lib::midi::{
    knob_db, led_messages, tempo_pitch, vu_value, Button, Control, Decoder, Dispatcher, Event,
    JogMode, LedCache, LedState, PadMode, UiEvent,
};
use bongplayer_lib::state::{AppState, DeckName};
use engine::{new_engine, offline, DeckId, Engine};
use library::Library;

const SR: u32 = 48_000;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../crates/engine/tests/fixtures")
        .join(name)
}

fn decode_all(d: &mut Decoder, msgs: &[[u8; 3]]) -> Vec<Event> {
    msgs.iter().filter_map(|m| d.decode(m)).collect()
}

#[test]
fn decodes_buttons_pads_jogs_and_14_bit_controls() {
    let mut d = Decoder::default();
    assert_eq!(
        d.decode(&[0x90, 0x0B, 0x7F]),
        Some(Event::Button {
            deck: DeckName::A,
            button: Button::Play,
            pressed: true
        })
    );
    assert_eq!(
        d.decode(&[0x91, 0x0C, 0x00]),
        Some(Event::Button {
            deck: DeckName::B,
            button: Button::Cue,
            pressed: false
        })
    );
    assert_eq!(
        d.decode(&[0x81, 0x54, 0x40]),
        Some(Event::Button {
            deck: DeckName::B,
            button: Button::HeadphoneCue,
            pressed: false
        }),
        "note-off counts as release"
    );
    assert_eq!(
        d.decode(&[0x97, 0x03, 0x7F]),
        Some(Event::Pad {
            deck: DeckName::A,
            mode: PadMode::HotCue,
            index: 3,
            shift: false,
            pressed: true
        })
    );
    assert_eq!(
        d.decode(&[0x9A, 0x35, 0x7F]),
        Some(Event::Pad {
            deck: DeckName::B,
            mode: PadMode::Sampler,
            index: 5,
            shift: true,
            pressed: true
        })
    );
    assert_eq!(
        d.decode(&[0x99, 0x62, 0x7F]),
        Some(Event::Pad {
            deck: DeckName::B,
            mode: PadMode::BeatLoop,
            index: 2,
            shift: false,
            pressed: true
        })
    );
    assert_eq!(
        d.decode(&[0xB0, 0x22, 0x43]),
        Some(Event::Jog {
            deck: DeckName::A,
            mode: JogMode::Scratch,
            ticks: 3
        })
    );
    assert_eq!(
        d.decode(&[0xB1, 0x21, 0x3E]),
        Some(Event::Jog {
            deck: DeckName::B,
            mode: JogMode::Bend,
            ticks: -2
        })
    );
    assert_eq!(d.decode(&[0xB6, 0x40, 0x7F]), Some(Event::Browse(-1)));
    assert_eq!(d.decode(&[0xB6, 0x40, 0x01]), Some(Event::Browse(1)));
    assert_eq!(
        d.decode(&[0x96, 0x47, 0x7F]),
        Some(Event::Load(DeckName::B))
    );

    // 14-bit: the high byte arrives first and only the low byte produces a value.
    let ev = decode_all(&mut d, &[[0xB0, 0x13, 0x7F], [0xB0, 0x33, 0x7F]]);
    assert_eq!(ev.len(), 1);
    let Event::Control {
        deck,
        control,
        raw,
        value,
    } = &ev[0]
    else {
        panic!("{ev:?}")
    };
    assert_eq!(
        (*deck, *control, *raw),
        (Some(DeckName::A), Control::Fader, 16383)
    );
    assert!((value - 1.0).abs() < 1e-6);
    let ev = decode_all(&mut d, &[[0xB1, 0x07, 0x40], [0xB1, 0x27, 0x00]]);
    assert!(matches!(
        ev[0],
        Event::Control {
            deck: Some(DeckName::B),
            control: Control::Eq(BandName::High),
            raw: 8192,
            ..
        }
    ));
    let ev = decode_all(&mut d, &[[0xB6, 0x1F, 0x00], [0xB6, 0x3F, 0x00]]);
    assert!(matches!(
        ev[0],
        Event::Control {
            deck: None,
            control: Control::Crossfader,
            raw: 0,
            ..
        }
    ));
    let ev = decode_all(&mut d, &[[0xB6, 0x18, 0x20], [0xB6, 0x38, 0x00]]);
    assert!(matches!(
        ev[0],
        Event::Control {
            deck: Some(DeckName::B),
            control: Control::Filter,
            ..
        }
    ));
    // Unknown and short messages are ignored.
    assert_eq!(d.decode(&[0x90, 0x7E, 0x7F]), None);
    assert_eq!(d.decode(&[0xF8]), None);
}

#[test]
fn knob_and_tempo_scaling() {
    assert_eq!(knob_db(0.5, 24.0, 6.0), 0.0);
    assert_eq!(knob_db(0.0, 24.0, 6.0), -24.0);
    assert_eq!(knob_db(1.0, 24.0, 6.0), 6.0);
    // Tempo fader: centre = 0 %; low raw values are faster (raw 0 = +range).
    assert_eq!(tempo_pitch(8192, 0.08), 0.0);
    assert!((tempo_pitch(0, 0.08) - 0.08).abs() < 1e-9);
    assert!((tempo_pitch(16383, 0.16) + 0.16).abs() < 1e-3);
    assert_eq!(vu_value(0.0), 0);
    assert_eq!(vu_value(1.0), 127);
}

struct Rig {
    state: AppState,
    engine: Engine,
    disp: Dispatcher,
    dec: Decoder,
    ui: Vec<UiEvent>,
}

impl Rig {
    fn new(dir: &Path) -> Self {
        let db = dir.join("lib.db");
        let (handle, engine) = new_engine(SR);
        let state = AppState::new(db.clone(), Library::open(&db).expect("db"), handle, None);
        Self {
            state,
            engine,
            disp: Dispatcher::default(),
            dec: Decoder::default(),
            ui: Vec::new(),
        }
    }

    fn midi(&mut self, msgs: &[[u8; 3]]) {
        for m in msgs {
            if let Some(ev) = self.dec.decode(m) {
                let ui = &mut self.ui;
                self.disp
                    .handle(&self.state, ev, Instant::now(), &mut |e| ui.push(e));
            }
        }
        offline::render(&mut self.engine, 480);
    }

    fn load(&mut self, deck: DeckName, file: &Path) {
        let (rows, _) = bongplayer_lib::state::lock(&self.state.library)
            .tracks_for_paths(&[file.to_path_buf()])
            .expect("scan");
        self.state.load_track(deck, rows[0].id).expect("load");
        offline::render(&mut self.engine, 4800);
    }
}

#[test]
fn the_controller_drives_decks_mixer_pads_and_headphones() {
    let dir = tempfile::tempdir().expect("tmp");
    let song = dir.path().join("tone.wav");
    std::fs::copy(fixture("tone_48000.wav"), &song).expect("copy");
    let mut r = Rig::new(dir.path());
    r.load(DeckName::A, &song);

    // PLAY toggles.
    r.midi(&[[0x90, 0x0B, 0x7F], [0x90, 0x0B, 0x00]]);
    assert!(r.state.status.deck(DeckId::A).is_playing());

    // Tempo fader all the way up (raw 0) with the ±8 % range = +8 %.
    r.midi(&[[0xB0, 0x00, 0x00], [0xB0, 0x20, 0x00]]);
    assert!((r.state.status.deck(DeckId::A).pitch() - 0.08).abs() < 1e-6);

    // Crossfader fully right; the screen is told.
    r.midi(&[[0xB6, 0x1F, 0x7F], [0xB6, 0x3F, 0x7F]]);
    assert!((r.state.status.crossfader() - 1.0).abs() < 1e-6);
    assert!(r.ui.contains(&UiEvent::Mixer {
        deck: None,
        key: "crossfader",
        value: 1.0
    }));

    // EQ low turned fully down → the screen shows −24 dB.
    r.midi(&[[0xB0, 0x0F, 0x00], [0xB0, 0x2F, 0x00]]);
    assert!(r.ui.contains(&UiEvent::Mixer {
        deck: Some(DeckName::A),
        key: "low",
        value: -24.0
    }));

    // Headphone CUE button toggles the engine's cue.
    r.midi(&[[0x90, 0x54, 0x7F], [0x90, 0x54, 0x00]]);
    assert_eq!(r.state.status.cue(), [true, false]);

    // Hot cue pad 2: empty → set; SHIFT + pad → clear.
    r.midi(&[[0x97, 0x01, 0x7F], [0x97, 0x01, 0x00]]);
    assert!(r.state.status.deck(DeckId::A).hot_cue(1).is_some());
    r.midi(&[[0x98, 0x01, 0x7F]]);
    assert!(r.state.status.deck(DeckId::A).hot_cue(1).is_none());

    // Beat-loop pad 3 = 1 beat needs a BPM; without one it is refused with a notice.
    r.midi(&[[0x97, 0x62, 0x7F]]);
    assert!(r
        .ui
        .iter()
        .any(|e| matches!(e, UiEvent::Notice { text } if text.contains("BPM"))));

    // Jog: touch, turn forward 100 ticks (0.25 s of audio), release.
    r.midi(&[[0x90, 0x0B, 0x7F]]); // pause
    let before = r.state.status.deck(DeckId::A).position();
    r.midi(&[[0x90, 0x36, 0x7F]]);
    assert!(r.state.status.deck(DeckId::A).is_scratching());
    for _ in 0..10 {
        r.midi(&[[0xB0, 0x22, 64 + 10]]);
    }
    r.midi(&[[0x90, 0x36, 0x00]]);
    offline::render(&mut r.engine, 9600);
    let moved = (r.state.status.deck(DeckId::A).position() - before) / f64::from(SR);
    assert!((moved - 0.25).abs() < 0.03, "scratched {moved} s");
    assert!(!r.state.status.deck(DeckId::A).is_scratching());

    // Sampler pad 1 plays the sampler's first pad.
    r.state
        .sampler_load(0, &fixture("tone_44100.wav"))
        .expect("pad");
    r.midi(&[[0x99, 0x30, 0x7F]]);
    assert_eq!(r.state.status.pads_playing() & 1, 1);

    // LOAD and browse go to the screen.
    r.midi(&[[0x96, 0x46, 0x7F], [0xB6, 0x40, 0x7E]]);
    assert!(r.ui.contains(&UiEvent::Load { deck: DeckName::A }));
    assert!(r.ui.contains(&UiEvent::Browse { steps: -2 }));
}

#[test]
fn ring_bends_while_playing_and_lets_go() {
    let dir = tempfile::tempdir().expect("tmp");
    let song = dir.path().join("tone.wav");
    std::fs::copy(fixture("tone_48000.wav"), &song).expect("copy");
    let mut r = Rig::new(dir.path());
    r.load(DeckName::B, &song);
    r.midi(&[[0x91, 0x0B, 0x7F]]);
    r.midi(&[[0xB1, 0x21, 64 + 10]]);
    let tempo = r.state.status.deck(DeckId::B).tempo();
    assert!((tempo - 1.04).abs() < 1e-3, "bent to {tempo}");
    r.disp
        .tick(&r.state, Instant::now() + Duration::from_millis(150));
    offline::render(&mut r.engine, 480);
    assert!(
        (r.state.status.deck(DeckId::B).tempo() - 1.0).abs() < 1e-6,
        "released"
    );
}

#[test]
fn lock_blocks_the_controller_with_one_notice_per_second() {
    let dir = tempfile::tempdir().expect("tmp");
    let song = dir.path().join("tone.wav");
    std::fs::copy(fixture("tone_48000.wav"), &song).expect("copy");
    let mut r = Rig::new(dir.path());
    r.load(DeckName::A, &song);
    r.state.lock_engage().expect("lock");
    r.midi(&[[0x90, 0x0B, 0x7F], [0x90, 0x0B, 0x7F], [0x97, 0x00, 0x7F]]);
    assert!(!r.state.status.deck(DeckId::A).is_playing());
    assert!(
        r.state.status.deck(DeckId::A).hot_cue(0).is_none(),
        "hot cue not set while locked"
    );
    let notices =
        r.ui.iter()
            .filter(|e| matches!(e, UiEvent::Notice { .. }))
            .count();
    assert_eq!(notices, 1);
}

#[test]
fn leds_follow_the_decks_and_only_changes_are_sent() {
    let mut l = LedState {
        loaded: [true, false],
        playing: [true, false],
        headphone: [false, true],
        level: [1.0, 0.0],
        ..LedState::default()
    };
    l.hot_cues[0][2] = true;
    l.pads_loaded[4] = true;
    let msgs = led_messages(&l);
    assert!(msgs.contains(&[0x90, 0x0B, 0x7F]), "play A lit");
    assert!(msgs.contains(&[0x91, 0x0B, 0x00]));
    assert!(
        msgs.contains(&[0x90, 0x0C, 0x00]),
        "cue unlit while playing"
    );
    assert!(msgs.contains(&[0x91, 0x54, 0x7F]), "headphone B lit");
    assert!(msgs.contains(&[0x97, 0x02, 0x7F]) && msgs.contains(&[0x97, 0x03, 0x00]));
    assert!(
        msgs.contains(&[0x97, 0x34, 0x7F]) && msgs.contains(&[0x99, 0x34, 0x7F]),
        "sampler pad 5 on both sides"
    );
    assert!(msgs.contains(&[0xB0, 0x02, 127]));

    let mut cache = LedCache::default();
    assert_eq!(cache.changes(msgs.clone()).len(), msgs.len());
    assert!(
        cache.changes(msgs.clone()).is_empty(),
        "nothing changed, nothing sent"
    );
    l.playing[0] = false;
    let changed = cache.changes(led_messages(&l));
    assert_eq!(changed, vec![[0x90, 0x0B, 0x00], [0x90, 0x0C, 0x7F]]);
}
