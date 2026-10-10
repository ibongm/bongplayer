# Changelog

All notable changes to BongPlayer are recorded here, newest first, with the date and time
of each change (PC local time). Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Categories: **Added**, **Changed**, **Fixed**, **Removed**, **Security**.

## [Unreleased]

### 2026-10-10 05:13 — M1: Crossfader, master volume and limiter
- **Added:** the crossfader blends deck A and B at constant loudness: in the middle both play
  at −3 dB, so a blend does not dip or bump in volume. Master volume up to +6 dB.
- **Added:** a limiter on the master output. Nothing ever goes above the ceiling (default
  −1 dBFS), whatever is played and however loud the faders are set, so the bar's amplifier never
  gets a clipped signal. It looks 1.5 ms ahead so the volume is already down before a peak
  arrives.
- **Fixed:** a code-style warning left in the previous commit (an internal method name); no
  change in behaviour.
- **Tests:** 5 tests pass — crossfader gains satisfy A² + B² = 1 at 101 positions (within
  0.000001) and measured output power follows it; the limiter keeps +12 dB sine, square, noise,
  a silence-to-full-blast jump and +18 dB single-sample spikes at or below the ceiling (−1, −0.1
  and −6 dB tested; peaks measured −1.0001 / −0.1001 / −6.0001 dBFS), including with master at
  +6 dB; and it does not squash normal loud signals.
- **Not verified:** how the limiter sounds on real music (owner listening check later, M5 soak test).
- **Commit:** pending

### 2026-10-10 05:11 — M1: 3-band EQ with kills, trim and channel fader
- **Added:** each mixer channel now has trim (input gain, up to +12 dB), a DJ-style 3-band EQ
  and a channel fader. The EQ is an "isolator": bass / mid / treble split at 300 Hz and 4 kHz,
  each band from fully off up to +6 dB, plus a kill switch per band. All controls glide over a
  few milliseconds so turning them never clicks.
- **Tests:** 6 EQ tests pass — with all bands at 0 dB the sound is unchanged from 20 Hz to
  20 kHz (largest deviation 0.03 dB, limit 0.5 dB); ±6 dB per band measures exactly ±6.000 dB at
  the band centre; kills reach −112 dB (bass), −85 dB (mid), −92 dB (treble), limit −60 dB;
  trim and fader levels are correct.
- **Not verified:** how the EQ sounds; the knob feel comes with the mixer screen in M4.
- **Commit:** f3aa036

### 2026-10-10 05:10 — M1: Deck playback, seek and hot cues
- **Added:** the deck: load a track, play, pause, seek, and 8 hot cues (set, jump, clear). It
  plays any file on any sound-card rate: a 44.1 kHz song on a 48 kHz output is converted with a
  high-quality resampler built into the engine.
- **Decision:** our own resampler instead of the `rubato` library listed in the plan. The deck
  reads the track from memory at any fractional position, so the same code will also do pitch,
  reverse play and scratching in M2, which `rubato` cannot. `PLAN.md` will be updated at the end of M1.
- **Tests:** 4 deck tests pass — at the same rate the output is identical to the file, sample
  for sample; 44.1 → 48 kHz has an error of −91 dB (target ≤ −80 dB) and the exact length
  (96,000 frames); seek and hot-cue jumps land exactly at the same rate and within 1 ms when
  resampling. Plus 3 small internal tests.
- **Not verified:** none (no sound is played yet).
- **Commit:** d314957

### 2026-10-10 05:05 — M1: Engine reads MP3, FLAC, WAV, M4A and OGG
- **Added:** the audio engine (`crates/engine`, pure Rust, no app window yet). It opens a music
  file and decodes it in the background into memory as 16-bit stereo (≈ 11 MB per minute), so
  playback can start before decoding has finished. Mono files play on both sides; files with
  more than two channels are mixed down to stereo.
- **Added:** a missing, unsupported or damaged file gives a clear error message instead of a
  crash. A file that breaks halfway keeps the part that was decoded.
- **Added:** M4A files are trimmed to their real length: the silent lead-in and tail that AAC
  encoders add (≈ 23 ms) are removed, as already happens for MP3 and OGG. This matters for
  seamless Automix transitions later.
- **Decision:** decoding library `symphonia` added. Licence **MPL-2.0**: free to use unchanged in
  BongPlayer; only changes to symphonia's own files would have to be published (we make none).
- **Tests:** 9 decode tests pass — every format gives the exact length (2.000 s, off by 0 frames)
  and the right sample rate and volume; missing and damaged files give errors, not crashes.
  Plus 8 small internal tests.
- **Not verified:** none (no sound is played yet).
- **Commit:** d89a953

### 2026-10-10 05:05 — M1: Test audio files for the engine
- **Added:** short test tones (2 seconds, 1 kHz, half volume, stereo) in every format the
  engine must read: WAV and FLAC at 44.1 and 48 kHz, MP3, M4A (AAC) and OGG (Vorbis), plus a
  deliberately broken file. They were made with our own script, so there is no copyright issue;
  about 1 MB in total.
- **Decision:** the script uses ffmpeg, downloaded as a portable copy into a git-ignored `tools/`
  folder on this PC. ffmpeg is only for making test files; it is not part of BongPlayer.
- **Tests:** none yet (the files are used by the decoder tests in the next entry).
- **Not verified:** none.
- **Commit:** 68d69e3

### 2026-10-10 04:46 — M0: Manual check passed — M0 complete
- **Changed:** `PLAN.md` — the manual M0 test is ticked. The owner installed the app from the
  GitHub installer: the window opens with the app shell, and the titlebar works (moving the window,
  minimise / maximise / close, tooltips). All M0 acceptance tests now pass.
- **Tests:** owner's manual check on a real PC (reported "Everything works").
- **Not verified:** none for M0.
- **Commit:** 1476a82

### 2026-10-10 04:24 — M0: Automated M0 tests ticked in the plan
- **Changed:** `PLAN.md` — the two automated M0 tests are ticked: the project skeleton with
  `cargo test`, `tsc --noEmit` and `vitest` running in CI, and GitHub building and uploading the
  Windows installer. The manual test (install and open on a real PC) stays unticked.
- **Tests:** GitHub Actions run 38015956130 on `m0-scaffold` passed both jobs ("Lint, typecheck
  and tests" and "Windows installer (NSIS)"); artifact `bongplayer-windows-installer` (1.8 MB) uploaded.
- **Not verified:** installer runs on the bar PC and the window opens with the app shell (owner check).
- **Commit:** fbe163a

### 2026-10-10 04:09 — M0: Automatic build on GitHub (CI) with Windows installer
- **Added:** every push to GitHub now runs all checks (lint, typecheck, interface tests, Rust
  formatting, clippy, Rust tests) on a Windows machine, and then builds the Windows installer
  (`BongPlayer_<version>_x64-setup.exe`). The installer is attached to the run as a download
  named `bongplayer-windows-installer`.
- **Decision:** the installer is not code-signed (signing is not in the plan), so Windows
  SmartScreen will warn on first install: click "More info" → "Run anyway".
- **Tests:** locally `npm run tauri build` produced `BongPlayer_0.1.0_x64-setup.exe` (1.8 MB).
  The GitHub run result is recorded in the next entry.
- **Not verified:** installing and opening the app on the bar PC (owner check).
- **Commit:** d6a6db8

### 2026-10-10 04:09 — M0: Development server port changed to 5173
- **Fixed:** `npm run dev` / `npm run tauri dev` could not start on this PC ("permission denied"
  on port 1420). Windows (Hyper-V / WSL) reserves ports 1359–1458 here. The development server
  now uses port 5173. This only affects development, not the installed app.
- **Tests:** `npm run dev` starts and serves the page on port 5173 (checked by HTTP request).
- **Not verified:** none.
- **Commit:** 5b6c11a

### 2026-10-10 04:05 — M0: Automatic checks (lint, typecheck, tests)
- **Added:** automatic checks that run with one command each: code style (`npm run lint`),
  type checking (`npx tsc --noEmit`), interface tests (`npm run test`) and Rust tests
  (`cargo test --workspace`), plus Rust formatting and `clippy` warnings-as-errors.
- **Added:** first tests: the titlebar shows the version from Rust; a failed connection to Rust
  shows a visible error bar; the window buttons have tooltips naming their shortcuts; only the
  titlebar (not its buttons) drags the window; Rust's `app_info` returns the right name and version.
- **Decision:** TypeScript is pinned to 6.0 because the lint tool (typescript-eslint) does not
  support TypeScript 7 yet. Revisit when it does.
- **Tests:** 8 interface tests and 2 Rust tests pass; lint, tsc, `cargo fmt --check` and
  `cargo clippy -D warnings` are clean.
- **Not verified:** none.
- **Commit:** 92d0942

### 2026-10-10 04:00 — M0: App shell with custom titlebar
- **Added:** BongPlayer's own titlebar: logo, name and version (read from the Rust side), and
  minimise / maximise / close buttons with tooltips showing the Windows shortcuts. The titlebar
  can be dragged to move the window. The rest of the window is empty until later milestones.
- **Added:** the default skin "Midnight Slate"; every colour is a skin variable, so other skins
  can be added later as data.
- **Added:** if the interface cannot reach the Rust side, a red error bar says so instead of
  failing silently. In a plain browser (`npm run dev`) the interface uses stand-in answers.
- **Tests:** `npx tsc --noEmit` and `npm run build` pass (automated UI tests come in the next commit).
- **Not verified:** window dragging and the three window buttons need the installed app (owner check).
- **Commit:** 1f07944

### 2026-10-10 03:59 — M0: Project skeleton (Rust + Tauri v2 + React 19)
- **Added:** the empty application skeleton: a Rust workspace with the Tauri v2 desktop app,
  and a React 19 + TypeScript + Vite + Tailwind user interface. The app has its own BongPlayer
  icon and a borderless window (our own titlebar comes next).
- **Added:** one test command between the interface and Rust (`app_info`: app name and version),
  which proves the two halves can talk to each other.
- **Decision:** the audio engine (`crates/engine`) and library (`crates/library`) are not created
  yet — they would be empty placeholders. They arrive in M1 and M3.
- **Tests:** `cargo build --workspace` and `npx tsc --noEmit` pass.
- **Not verified:** none yet (the window is checked after the installer exists).
- **Commit:** d085799

### 2026-10-10 03:59 — M0: Repository basics
- **Added:** ignore rules for build output (`node_modules`, `target`, `dist`) and consistent
  line endings, so only real source files end up in git.
- **Tests:** none (repository settings only).
- **Not verified:** none.
- **Commit:** 5f0e4bf

### 2026-10-10 — Planning: new plan and rules (no application code yet)
- **Added:** `PLAN.md` v2.1 — Rust audio engine, layout from the owner's references, 12
  milestones (M0–M11) with an acceptance test for every feature, including the old app's
  failures (drag & drop, hover submenus, radio, endless "analyzing").
- **Added:** `CLAUDE.md` — working rules for Claude Code (one milestone at a time, branches,
  honest verification, this changelog).
- **Removed:** the old Web Audio–based plan and rules; audio now lives in Rust. SANDBOX dropped
  (not in the new plan).
- **Tests:** none (documents only).
- **Not verified:** nothing built yet.
