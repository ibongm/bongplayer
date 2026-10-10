# BongPlayer — instructions for Claude Code

@PLAN.md

BongPlayer is a music player for a bar: Automix runs unattended through the day, and a
resident DJ takes over at night (decks, platters, Pioneer DDJ-400). Windows 10/11 x64,
mouse and keyboard only. At night the audio path is Laptop → DDJ-400 → bar mixer.

The owner may not read code. Report in plain language: what changed, what was tested,
what still needs a human check.

## 1. How to work

- `PLAN.md` is the single source of truth. It holds the milestones (M0–M11) and the
  acceptance tests. Do not create a second TODO list.
- **One milestone at a time.** Start each one by proposing a short plan (use plan mode) and
  wait for approval. Do not begin the next milestone until the owner says so.
- Work on a branch per milestone (`m3-library`), commit per feature, push the branch.
  Never push straight to `main`, never force-push, never rewrite history.
- Tick an acceptance test in `PLAN.md` only when it actually passes. Automated tests: run
  them and show the result. Manual (**M**) tests: leave them unticked and list exactly what
  the owner must check on the bar PC.
- Commit messages: `m3: short description of what was delivered`.

## 1a. Changelog — keep it current, always

`CHANGELOG.md` is a running log the owner reads. Update it **in the same commit as every
change that affects behaviour** (feature, fix, removal, decision) — not just at the end of a
milestone. Never leave a commit with an out-of-date changelog.

- Newest entry first, under `## [Unreleased]`.
- Each entry has a **date and time** taken from the PC clock (run
  `Get-Date -Format "yyyy-MM-dd HH:mm"`; never guess or invent a time) and the milestone:
  `### 2026-10-10 14:32 — M3: Drag & drop from Explorer to decks`
- Under it, plain-language bullets grouped as **Added / Changed / Fixed / Removed / Security**,
  saying *what changed for the user* (not file names), then:
  - `Commit:` the short hash (add it in a follow-up commit if needed)
  - `Tests:` which automated tests cover it and that they pass
  - `Not verified:` anything that still needs a manual check on the bar PC (or "none")
- Record decisions and things that were cut or postponed too, with the reason.
- On a release, move `[Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD`, keeping their
  timestamps, and tag the commit `vX.Y.Z`.

## 2. Architecture — hard rules

- **All audio runs in Rust** (`crates/engine`). The webview never creates an `AudioContext`,
  never plays sound and never decodes audio. The UI sends commands and draws what the engine
  reports (positions, meters, waveform peaks).
- `crates/engine` has no Tauri dependency and must work with an **offline renderer** (same
  graph → WAV), because most audio behaviour is verified by tests, not by ear.
- `crates/library` owns SQLite (tags, analysis, cues, crates/playlists, covers, settings,
  resume state). `src-tauri` is thin glue: commands, window, native file drop, MIDI.
- **Audio-thread rules:** no allocation, locks, file or network I/O, or logging inside the
  audio callback. Use lock-free queues and atomics. A panic in the audio thread is a bug;
  the engine must survive device loss and reopen the default device.
- **Never dead air:** missing or corrupt files are skipped, the queue continues.
- All file access happens in Rust. Use `PathBuf`; no manual path string handling. No
  hardcoded drive-letter scopes.
- Per-frame UI state (playhead, meters) lives in refs and canvases, **not** in a React/Zustand
  store updated at 60 Hz.

## 3. UI rules

- **Drag & drop:** files from Windows Explorer use Tauri's native drop event. Dragging inside
  the app (table → deck / queue / crate, queue reorder) uses our own pointer-event drag layer.
  **Never use HTML5 drag & drop for internal drags** — Tauri's native handler disables it on
  Windows, which is why the old app's drag & drop never worked.
- Context menus are our own component: submenus open on hover and with the → key; actions
  apply to the whole selection and state how many tracks they affect.
- Tables are virtualised (50,000-file libraries). Multi-select: click, Ctrl, Shift, Ctrl+A, Esc.
- Every control has a tooltip with its keyboard shortcut and a keyboard path. Minimum text
  size 11 px. Use the full window width.
- All colours are CSS variables so skins are data (`:root[data-theme="…"]`).
- Never show an endless spinner: show progress, then a result or a visible error.
- **Internet features (cover/metadata lookup, lyrics) are opt-in and OFF by default.**
- Wrap every `invoke()` in `try/catch` and turn Rust errors into visible UI states.

## 4. Stack conventions

- **Tauri v2:** `import { invoke } from "@tauri-apps/api/core"`; windows via
  `@tauri-apps/api/webviewWindow`; plugins via `@tauri-apps/plugin-*`. No v1 APIs. Declare every
  new permission in `src-tauri/capabilities/default.json`.
- Custom titlebar (`decorations: false`): mark drag zones with `data-tauri-drag-region`; controls
  inside them must not start window drags.
- **React 19:** no `forwardRef` (pass `ref` as a prop), no `defaultProps`, use `useActionState` /
  `useOptimistic` / `use()` where they fit.
- **TypeScript:** `strict`, no `any` (use `unknown` + type guards), explicit types for IPC payloads.
- **Rust:** edition 2021, `cargo fmt` and `cargo clippy` clean, no `unwrap()` outside tests.
- Dependencies: ask before adding any large one. Check the licence first (e.g. Rubber Band is
  GPL — flag it, don't just add it).

## 5. Commands (PowerShell on Windows)

Use PowerShell syntax only (no `rm -rf`, no `export`). Create any command below that doesn't
exist yet during M0.

```powershell
npm run tauri dev                        # app with hot reload
npm run dev                              # UI alone in a browser (mock IPC)
npm run tauri build                      # release installer
npx tsc --noEmit                         # typecheck, zero errors
npm run lint
npm run test                             # frontend tests
cargo test --workspace                   # engine / library / glue tests
cargo clippy --workspace -- -D warnings
cargo fmt --all -- --check
```

## 6. Honesty and verification

- Claude cannot hear audio and cannot test the DDJ-400, WASAPI/ASIO output or the real radio
  stations. Verify audio with offline-render tests; say plainly which checks were not possible.
- Never claim something works unless you ran it. If a test fails, report the failure and its output.
- **Never skip, disable, delete or loosen a test to get green.**
- No placeholders, `TODO` stubs or fake UI for planned features. If something is cut or
  postponed, say so and update `PLAN.md`.
- Don't add features that aren't in `PLAN.md` (the old app had unexplained buttons like
  SANDBOX). Ask first.

## 7. Safety

- Work only inside this repository. Don't read, move or delete files elsewhere on the PC.
- Old app source, if present, lives in `old/` as read-only reference. Don't port code from it
  blindly — its audio was built on the Web Audio API, which this project replaces.
