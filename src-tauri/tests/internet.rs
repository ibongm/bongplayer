//! M7 acceptance (app): internet lookup is OFF by default.

use bongplayer_lib::state::{lock, AppState};
use engine::new_engine;
use library::Library;

#[test]
fn internet_lookup_is_off_by_default_and_only_on_when_switched_on() {
    let dir = tempfile::tempdir().expect("tmp");
    let db = dir.path().join("lib.db");
    let (handle, _engine) = new_engine(48_000);
    let state = AppState::new(db.clone(), Library::open(&db).expect("db"), handle, None);
    assert!(
        !state.internet_lookup_on(),
        "a new installation never goes online"
    );
    lock(&state.library)
        .set_setting(bongplayer_lib::INTERNET_LOOKUP_KEY, "1")
        .expect("set");
    assert!(state.internet_lookup_on());
    lock(&state.library)
        .set_setting(bongplayer_lib::INTERNET_LOOKUP_KEY, "0")
        .expect("set");
    assert!(!state.internet_lookup_on());
}
