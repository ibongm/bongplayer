//! M10 (app): skin files are read only when they are small .json files.

use bongplayer_lib::commands::read_skin_file;

#[test]
fn skin_files_must_be_small_json_files() {
    let dir = tempfile::tempdir().expect("tmp");
    let ok = dir.path().join("Night.JSON");
    std::fs::write(&ok, r##"{"name":"Night","colors":{"accent":"#ff0000"}}"##).expect("write");
    assert!(read_skin_file(&ok).expect("read").contains("Night"));

    let css = dir.path().join("skin.css");
    std::fs::write(&css, ":root{}").expect("write");
    assert!(read_skin_file(&css).expect_err("css").contains(".json"));

    let big = dir.path().join("big.json");
    std::fs::write(&big, vec![b' '; 65 * 1024]).expect("write");
    assert!(read_skin_file(&big).expect_err("big").contains("too large"));

    assert!(read_skin_file(&dir.path().join("missing.json")).is_err());
}
