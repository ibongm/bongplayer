//! M11 (app): the screen's effect and headphone commands reach the engine; while locked the
//! headphones stay usable (they change nothing the audience hears) but effects do not.

use bongplayer_lib::commands::{lock_action, to_engine, UiCommand};
use bongplayer_lib::lock::Action;
use bongplayer_lib::state::AppState;
use engine::fx::FxKind;
use engine::{new_engine, Command, DeckId};
use library::Library;

fn ui(json: &str) -> UiCommand {
    serde_json::from_str(json).expect(json)
}

#[test]
fn effect_and_cue_commands_map_to_the_engine_and_lock_rules() {
    let dir = tempfile::tempdir().expect("tmp");
    let db = dir.path().join("lib.db");
    let (handle, _engine) = new_engine(48_000);
    let state = AppState::new(db.clone(), Library::open(&db).expect("db"), handle, None);

    let fx = ui(r#"{"type":"fx","deck":"B","kind":"flanger"}"#);
    assert_eq!(lock_action(&fx), Action::Music);
    assert!(matches!(
        to_engine(&state, fx).expect("fx"),
        Command::SetFx {
            deck: DeckId::B,
            kind: FxKind::Flanger
        }
    ));
    let params = ui(r#"{"type":"fxParams","deck":"A","strength":0.5,"speed":0.25}"#);
    assert!(matches!(
        to_engine(&state, params).expect("params"),
        Command::SetFxParams { deck: DeckId::A, strength, speed } if strength == 0.5 && speed == 0.25
    ));
    let cue = ui(r#"{"type":"cue","deck":"A","on":true}"#);
    assert_eq!(lock_action(&cue), Action::Volume);
    assert!(matches!(
        to_engine(&state, cue).expect("cue"),
        Command::SetCue {
            deck: DeckId::A,
            on: true
        }
    ));
    let mix = ui(r#"{"type":"cueMix","mix":0.3}"#);
    assert_eq!(lock_action(&mix), Action::Volume);
    assert!(matches!(to_engine(&state, mix).expect("mix"), Command::SetCueMix(m) if m == 0.3));
    assert!(
        serde_json::from_str::<UiCommand>(r#"{"type":"fx","deck":"A","kind":"reverb"}"#).is_err()
    );
}
