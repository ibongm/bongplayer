# Changelog

All notable changes to BongPlayer are recorded here, newest first, with the date and time
of each change (PC local time). Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Categories: **Added**, **Changed**, **Fixed**, **Removed**, **Security**.

## [Unreleased]

### 2026-10-10 06:16 — M3: Music library core — tag cache, BPM/key analysis, crates, playlists, M3U import
- **Added:** the music library database (`crates/library`, SQLite). It remembers every track's
  tags (title, artist, album, remix, genre, year, length, BPM, key, cover yes/no), so a folder
  opened a second time is not read from disk again; only new or changed files are. A file that
  has disappeared is marked "missing" instead of vanishing.
- **Added:** when tags are missing, artist and title come from the file name ("01 - Artist -
  Title.mp3"); "(Extended Mix)" and similar go into a separate Remix column.
- **Added:** BPM and key analysis. It uses about a minute from the middle of the track, many
  tracks in parallel. Half/double-tempo mistakes (the old app's "163 vs 82") are avoided by
  following the kick drum and bass. Keys are shown in Camelot notation (8A = A minor).
  A manual BPM always wins over the analysed one.
- **Added:** crates (a set of tracks) and playlists (ordered, repeats allowed): create, rename,
  delete, add, remove. Hot cues, ratings, play count / last played and settings are stored.
- **Added:** `.m3u` / `.m3u8` import as a playlist: relative and absolute paths, old Windows
  text encoding; files that cannot be found and web-stream lines are listed, not dropped.
- **Added:** drive list (including USB sticks and network drives) and one-folder-at-a-time
  browsing — never a full disk scan.
- **Changed:** debug builds now optimise third-party libraries (decoders, SQLite, FFT) so the
  development app plays smoothly and speed tests measure real speed.
- **Tests:** 21 library tests pass — BPM within 0.1 of the true value at 70, 82, 95, 117, 124,
  128, 140, 168 and 174 BPM (82 and 168 no longer flip to 164 / 84); 8 of 8 keys correct;
  MP3 files analysed correctly (128 BPM 8A, 82 BPM 9B, 168 BPM 12B); speed **70.7 tracks/s**
  on this PC (target ≥ 5); a 50,000-track library opens in **0.12 s** (target < 1 s); second
  folder scan reads 0 files from disk; crates/playlists/M3U behave as described.
- **Not verified:** BPM/key of the owner's real songs — the plan's regression list (Come
  Together, Smells Like Teen Spirit, Johnny B. Goode) needs the owner's files and confirmed
  values; the synthetic tests above stand in for now. Speed on the bar laptop (fewer cores).
- **Commit:** pending

### 2026-10-10 05:57 — M2: Preferred output device (DDJ-400) with automatic switching
- **Added:** a preferred output device. When it is plugged in, the music moves to it; when it
  disappears, the music falls back to the Windows default device and keeps playing; when it
  comes back, the music moves back. Choosing a preferred device while music plays switches at
  once. Each move takes well under a second of silence.
- **Added:** the output also notices a device that is unplugged without the driver saying so
  (it checks the device list twice a second).
- **Added:** test program options: `play_file -- --devices` lists the output devices with their
  ids; `play_file -- --prefer <id> <file>` plays on that device whenever it is plugged in.
- **Added:** headphone-cue test program `channel_test <device id>`: plays a low tone on channels
  1–2 and a high tone on channels 3–4, to find out whether the DDJ-400 headphones can be reached
  through normal Windows audio (the M2 headphone spike).
- **Tests:** 5 output tests pass (2 new) — preferred device plugged in → switch; unplugged →
  fall back to the default; plugged in again → switch back; choosing a preferred device while
  playing switches; every move leaves less than 1 s of silence; the earlier recovery tests
  still pass. On this PC the device list shows the real devices (Realtek headphones, LG monitor).
- **Not verified:** with the real DDJ-400 — owner check (switching, and the headphone spike with
  `channel_test`).
- **Commit:** 8c5e814

### 2026-10-10 05:54 — M2: Pitch, key lock, pitch bend and scratching on the decks
- **Decision (owner, 2026-10-10):** after M1 the owner checked `play_file`: music played fine
  (the unplug test was not tried). The owner then asked to build M2–M11 in one go on one branch
  (`m2-m11`) without stopping for plan approval at each milestone, chose **Signalsmith Stretch**
  (MIT) for key lock instead of Rubber Band (GPL), and allowed libraries with permissive
  licences to be added without asking first.
- **Added:** pitch fader with ranges ±8 %, ±16 % and ±50 %; pitch changes the speed (and the
  musical pitch, like a turntable). Pitch bend nudges the speed temporarily (up to ±10 %).
- **Added:** key lock: change the tempo without changing the musical key. The position shown is
  what you actually hear (the key-lock processing delay is compensated).
- **Added:** scratching: while the platter is held, the track follows the hand forwards and
  backwards like a record; letting go continues playback from there.
- **Decision:** Signalsmith Stretch is included as source code (`crates/stretch`, MIT licence
  files kept) instead of via its Rust package, because that package needs an extra compiler
  tool (LLVM) that the build machines don't have.
- **Tests:** 7 new deck tests and 1 pitch-shifter test pass — at ±8/16/50 % the deck moves
  exactly (1 ± pitch) × as fast and the tone moves with it (within 2 cents); with key lock the
  tone stays at 440 Hz within 5 cents at every setting from −50 % to +50 % (worst 4.4 cents)
  and is heard on time (0 ms error); scratching follows the hand forward and backward within
  2 frames; pitch bend works and releases.
- **Not verified:** how key lock *sounds* on real music (owner listening test, PLAN M2), and how
  scratching *feels* with the mouse (needs the deck screen, M4).
- **Commit:** 5511855

### 2026-10-10 05:30 — M1: All engine tests pass — M1 automated tests ticked
- **Changed:** `PLAN.md` — all 7 M1 acceptance tests ticked (all are automated). The
  dependency list now records the M1 decisions: `symphonia`, `cpal` and `rtrb` added; our own
  resampler instead of `rubato`.
- **Fixed:** the previous entry said 53 engine tests; the correct number is 45.
- **Tests:** GitHub Actions run 38020249228 on `m1-engine` passed both jobs; it ran all 45
  engine tests plus the app's checks, and built the installer.
- **Not verified:** owner checks with the `play_file` test program — real music through the
  speakers, and unplugging/replugging the output device while it plays.
- **Commit:** 01f7397

### 2026-10-10 05:21 — M1: Realtime engine, sound-card output and recovery when the device is lost
- **Added:** the complete engine: two decks → mixer → sound card. The app sends it commands
  (load, play, pause, seek, hot cues, EQ, faders, crossfader, master, limiter) through a
  lock-free queue; the engine reports positions back. While playing it never waits for locks,
  never allocates memory and never touches files, so it cannot stutter because of the rest of the app.
- **Added:** output to the default sound card (WASAPI). If the device disappears (unplugged,
  driver reset) or stops asking for audio for 2 seconds, the engine reopens the default device
  and carries on from the same position with all settings; if no device exists it keeps
  retrying. Sound cards with 4 channels (like the DDJ-400) get the music on channels 1–2.
- **Added:** offline renderer: the same engine can render into memory or a WAV file, which is
  how all audio behaviour is tested.
- **Added:** a small test program (`play_file`) that plays one file through the real sound
  card, for the owner's listening check.
- **Decision:** libraries `cpal` (sound-card output, Apache-2.0) and `rtrb` (lock-free queue,
  MIT/Apache-2.0) added.
- **Tests:** 9 new tests pass (45 engine tests in total; corrected from "53") — fake sound card unplugged mid-song →
  reopened, playback continues from the same position, also when the new device runs at a
  different rate (48 → 44.1 kHz); no device for a while → keeps retrying, then plays; a device
  that hangs is detected after 2 s and reopened; no crash in any case. Commands reach the
  mixer; unloaded tracks are freed outside the audio thread. On this PC the real sound card
  opened at 48 kHz and played a silent test file in real time.
- **Not verified:** real unplugging of a sound card, and hearing actual music — owner check
  with `play_file` (instructions in the M1 summary).
- **Commit:** 702cdb0

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
- **Commit:** 53ff44a

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
