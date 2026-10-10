# Changelog

All notable changes to BongPlayer are recorded here, newest first, with the date and time
of each change (PC local time). Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Categories: **Added**, **Changed**, **Fixed**, **Removed**, **Security**.

## [Unreleased]

### 2026-10-10 07:29 — M6: Secure radio streams fixed; the two old stations found and working
- **Fixed (found by trying the real stations):** secure (https) streams would have stopped
  the radio connection with a crash, because a TLS option of the network library was not
  switched on — the local test server uses plain http, so the tests could not see it. Secure
  streams now use rustls and check certificates against the Windows certificate store.
- **Decision:** rustls / ring / the Windows-certificate-store verifier (Apache-2.0, ISC, MIT)
  instead of the library's built-in option, which would have added Mozilla's certificate list
  under the CDLA-Permissive-2.0 data licence — a licence outside the pre-approved list.
- **Found:** the real stream addresses of the two stations from the old app (PLAN open item):
  - Bravo (LIVE): `https://relay1.social3.hr/radio/8310/radio.mp3` (the old
    `player.html?stream=0` address is the web page around it);
  - Radio Dalmacija: `http://shoutcast.pondi.hr:8000/listen.pls` (also
    `https://shoutcast.pondi.hr:9000/;stream/1`); the old `radio.php` address is a web page.
- **Added:** test program `probe_station <url>` that tries station addresses with the real
  radio code (connects and decodes a moment of audio, plays nothing).
- **Tests:** on this PC with the real internet: Bravo → "bravo AAC (audio/mpeg)" decodes;
  Radio Dalmacija → "Radio Dalmacija (audio/aacp)" decodes via both addresses; the two old
  addresses give the "this is a web page, not a stream" message. All radio tests still pass.
- **Not verified:** listening to both stations through the speakers (owner).
- **Commit:** pending

### 2026-10-10 07:26 — M6: Internet radio engine — live deck source, station connection, titles, reconnect
- **Added:** decks can play a live stream. A live deck keeps only the last 30 seconds in
  memory (a station can play for days), plays 2 seconds behind the newest audio to ride out
  network hiccups, is silent (not noisy) while the stream stutters, and never "ends". Seek,
  loops, pitch and scratching do not apply to radio.
- **Added:** the radio part (`crates/radio`): opens a station address, follows redirects (e.g.
  a `radio.php` link), reads `.pls` and `.m3u` playlists, accepts old SHOUTcast servers
  ("ICY 200 OK"), plays MP3, AAC and Ogg streams, and shows the song title the station sends.
- **Added:** if a station address is a web page (like the bravo.hr player page), it says
  "this is a web page, not a stream — open it in a browser and look for the stream link"
  instead of failing silently. HLS (.m3u8 with segments) is reported as not supported yet.
- **Added:** after a drop-out the station reconnects by itself, waiting 1, 2, 4, 8 then 10 s
  between tries; a connection that stays silent for 15 s is abandoned and replaced.
- **Decision:** library `ureq` (MIT/Apache-2.0) for secure (https) streams, using Windows' own
  TLS (no extra crypto libraries); plain http uses a small built-in client with timeouts.
- **Tests:** 8 tests against a fake Icecast server on this PC pass — plain MP3 with ICY title
  changes, AAC, SHOUTcast reply, redirect, PHP link, `.pls`, `.m3u`, mid-stream disconnect →
  reconnect, HTML page → clear message and no retrying, HLS → "not supported", 404 → error.
  Plus 1 live-deck test and 7 small unit tests (titles stripped from the audio, playlists,
  URLs, ring buffer).
- **Not verified:** the two real stations from the old app (owner, on the bar PC).
- **Commit:** a7424ba

### 2026-10-10 07:19 — M5: Screens — Automix cockpit, LOCK, DUCK, master transport, DAY view, settings
- **Added:** Automix cockpit above the queue: START / STOP, Skip (next track now), transition
  style, Trigger and Fade seconds, Loop / Shuffle / Auto-remove. The playing entry (▶) and
  the next one (›) are marked in the queue; Automix messages (skipped files, empty queue) are
  shown. Changes are saved.
- **Changed:** the queue's "Shuffle" button is now the Automix Shuffle *mode* (random order,
  each track once per round), as the plan describes, instead of reordering the list once.
- **Added:** LOCK and DUCK in the top bar. LOCK: click to lock; when locked, click to type the
  PIN, or hold for 2 seconds (if allowed). Music controls then refuse with "Locked — unlock …".
  DUCK: click (or press D) to lower the music; click again to bring it back.
- **Added:** master PLAY / PAUSE / STOP under the crossfader.
- **Added:** **DAY** view (Ctrl+4) for staff: what is playing (big), what comes next, a
  progress bar, big START / NEXT / DUCK / LOCK buttons and the volume, with the queue beside it.
- **Added:** Settings tabs **Automix** (default trigger / fade / style / Loop / Shuffle /
  Auto-remove, "Start BongPlayer when Windows starts") and **Lock** (set / change / remove the
  PIN, "volume works while locked", "holding LOCK unlocks"); DUCK depth in the Audio tab.
- **Fixed:** the clock no longer wraps onto two lines in a narrow window.
- **Tests:** 7 new screen tests pass (57 in total): cockpit start / skip / stop and every
  setting; LOCK — a locked deck refuses PLAY with a message, a wrong PIN fails, the right PIN
  unlocks, holding 2 s unlocks; DUCK button and D key; master transport; DAY view shows now
  playing / up next; Settings saves Automix defaults and sets a PIN. Looked at in a browser.
- **Not verified:** "Start with Windows" (needs the installed app); the 12-hour soak test (owner).
- **Commit:** 896a75b

### 2026-10-10 07:12 — M5: Automix controller, resume after a crash, LOCK, DUCK (app side)
- **Added:** Automix plays the queue on its own: the next track is loaded early on the other
  deck; the transition (Smooth, Bass Swap, Cut or Echo-Out) starts when the playing track has
  the "trigger" time left and lasts the "crossfade" time; each finished track is counted as
  played. **Loop** starts the queue again at the end, **Shuffle** picks at random (each track
  once per round), **Auto-remove** takes played tracks out of the queue.
- **Added:** never dead air: a queued file that is missing or cannot be read is skipped (and
  reported); if the playing track stops on its own or its deck gets stuck for 3 s, the next
  track starts straight away. A deck the DJ pauses on purpose is left alone.
- **Added:** resume after a crash or reboot: the queue, the current track and its position are
  saved every 5 seconds; at start-up Automix continues where it was.
- **Added:** master PLAY (starts Automix or resumes a paused deck), PAUSE and STOP.
- **Added:** LOCK: while locked, play / pause / seek / cue / loops / sync / scratch, loading
  tracks, the crossfader, pitch, Automix and queue edits are refused by the app itself (not
  just greyed out). Volume and DUCK stay usable unless switched off. Unlock with the PIN or by
  holding LOCK (if allowed). The PIN is stored only as a salted SHA-256 hash.
- **Added:** DUCK command with an adjustable depth (default 12 dB), and the option to start
  BongPlayer when Windows starts (autostart plugin).
- **Decision:** libraries `sha2` (PIN hashing) and `tauri-plugin-autostart`, both
  MIT/Apache-2.0.
- **Tests:** 8 Automix tests play generated audio files through the real engine offline —
  the transition started with 3.95 s left (trigger 4 s, ticks every 0.05 s) and lasted 3.00 s
  (crossfade 3 s); queue order; Loop; Shuffle (every track once, different order);
  Auto-remove; a missing and a damaged file were skipped and the queue went on; after a
  simulated crash the queue came back identical and the track resumed at 3.05 s (saved at
  2.95 s), playing; LOCK blocks music controls, keeps volume (when allowed), refuses a wrong
  PIN, unlocks with the right PIN or a hold (when allowed); changing the PIN needs the old one.
  Plus 1 PIN-hash test.
- **Not verified:** the 12-hour soak test on the bar PC with a real playlist (owner, PLAN M5).
- **Commit:** 4206b5f

### 2026-10-10 07:04 — M5: Engine — Automix transitions, echo, DUCK
- **Added:** four Automix transitions, run inside the audio engine so they are exact:
  **Smooth** (equal-power crossfade), **Bass Swap** (crossfade, the two tracks' bass swapped
  half way so they never boom together), **Cut** (instant switch, 5 ms ramp, no click) and
  **Echo-Out** (the old track stops into an echo that fades out while the new one starts).
  When a transition ends, the old deck stops and the EQ / echo return to how the DJ left them.
- **Added:** DUCK in the engine: lowers the music by a set amount with a smooth ramp and brings
  it back (depth and ramp times adjustable).
- **Fixed (found by its test):** the DUCK ramp could stop 0.00002 dB short of full level.
- **Tests:** 5 transition tests and 2 effect tests pass — Smooth never dips (lowest 10 ms level
  95 % of one track), both tracks at −3 dB half way, only the new track at the end; Cut
  switches within 20 ms; Bass Swap: the new bass is held back until half way, then the old
  bass is gone; Echo-Out: new track at once, old track's echo audible and fading, gone at the
  end; DUCK reaches −12 dB in 0.3 s and comes back; echo repeats at the right time and level.
- **Not verified:** how the transitions sound on real music (owner).
- **Commit:** 5c1aec6

### 2026-10-10 07:00 — M4: Deck and mixer screens, three views, top bar, Settings (Audio)
- **Added:** three views, switched at the top (or Ctrl+1 / 2 / 3): **STANDARD** (waveforms,
  decks, mixer and library), **DECKS** (bigger decks, no library), **LIBRARY** (small decks and
  a big library).
- **Added:** top bar: venue clock, view tabs, keyboard-shortcut list (⌨), a status pill showing
  which sound card plays at which rate (red "NO OUTPUT" when none; click for audio settings),
  and ⚙ Settings.
- **Added:** scrolling waveforms of both decks at the top: playhead in the centre, colours by
  bass / mids / treble, hot cue flags, loop region, big A / B letters.
- **Added:** full decks: title / artist; BPM, KEY (+ key shift), GAIN, REMAIN, TOTAL and TAP
  (tap 4+ times to set the BPM); overview waveform (click to jump); loops 1–32 beats, IN / OUT,
  ½ / ×2, EXIT / RELOOP; hot cues 1–8 (click empty = set, click = jump, right-click = clear,
  saved per track); platter (drag around to scratch, wheel to nudge or move); pitch fader with
  ±8 / 16 / 50 % ranges, bend − / +, reset, KEY LOCK, key shift ♭ / ♯; CUE · PAUSE · PLAY ·
  CUP · SYNC. While a file is read the deck shows its progress, then the waveform — or an error.
- **Added:** centre mixer: per channel GAIN, HI / MID / LOW with kill buttons, FILTER, level
  meter and volume fader; MASTER level and meter; crossfader. Every knob and fader works with
  drag, mouse wheel and arrow keys, and resets with a right-click or double-click; every
  control has a tooltip.
- **Added:** keyboard: F1–F4 = deck A play / CUE / CUP / SYNC, F5–F8 = deck B; 1–8 = hot cues
  deck A, Shift+1–8 = deck B; Ctrl+, = Settings.
- **Added:** Settings window with the **Audio** tab: preferred output device (or follow the
  Windows default), what is playing now, limiter ceiling. Other tabs arrive with their
  features (M5–M10).
- **Tests:** 10 new screen tests pass (50 in total): hot cues set / jump / clear; every loop
  button; pitch bend while held; CUE press / release; CUP; TAP gives 120 BPM from taps 0.5 s
  apart; clicking the overview jumps to the right second; reading progress then a visible
  error (never an endless spinner); knobs adjust with arrows and reset on right-click; kills;
  crossfader; the three views; Settings saves the preferred device; F1 and 1 shortcuts.
  Looked at in a browser with a playing track: waveforms scroll, platter turns, meters move.
- **Not verified (owner, on the bar PC):** smooth 60 fps scrolling of both waveforms on the
  bar laptop; overview click accuracy; how scratching with the mouse feels; real audio of
  loops, CUE, filter and EQ.
- **Commit:** 7536398

### 2026-10-10 07:00 — M4: App — waveforms, SYNC, auto-loop in beats, output-device settings, stall guard
- **Added:** the waveform of each loaded track is computed in Rust (150 slices per second,
  with bass / mids / treble strength) and sent to the screen in a compact binary form.
- **Added:** SYNC sets a deck's pitch so its tempo matches the other deck (also half / double
  tempo; the pitch range widens if needed; a clear message if it would need more than ±50 %).
  Auto-loops are given in beats and use the track's BPM (a message asks to analyze or TAP
  first if there is none).
- **Added:** the screen can list the output devices, see which one is playing, and choose the
  preferred one (saved). The limiter ceiling chosen in Settings is saved and applied at start.
- **Added:** a deck never shows "analyzing" forever: if decoding makes no progress for 15
  seconds, the deck shows "decoding stopped responding" instead.
- **Tests:** 3 new app tests pass (waveform format, bass vs. treble colouring, a stalled
  decode is reported within the time limit instead of waited on forever).
- **Not verified:** with real tracks and the DDJ-400 (owner).
- **Commit:** 4a267a7

### 2026-10-10 06:46 — M4: Engine — loops, CUE / CUP, KEY shift, filter, level meters
- **Added:** loops: auto-loop of a number of beats, loop IN / OUT, halve / double, exit and
  re-enter. The jump back is sample-accurate (no click from overshooting), also with key lock.
- **Added:** CUE and CUP like a Pioneer deck: stopped → CUE sets the cue point and plays while
  held, release returns; playing → CUE jumps back and stops; CUP jumps to the cue and plays.
- **Added:** KEY shift: transpose −12 … +12 semitones, with or without key lock.
- **Added:** a filter knob per channel: left = low-pass (cuts treble), right = high-pass (cuts
  bass), centre = off.
- **Added:** level meters (peak and RMS) for deck A, deck B and the master output.
- **Fixed (found by the new tests):** a loop's OUT point could be overshot by one sample block
  before jumping back; with key lock on, the shown position could briefly fall outside the loop.
- **Tests:** 7 new engine tests pass — meters equal the RMS / peak of the rendered audio
  exactly; auto-loop repeats sample-for-sample and continues after exit; IN/OUT/halve/double;
  loops with key lock; CUE / CUP behaviour; KEY shift +12 = one octave up, −2 with key lock at
  +8 % = two semitones down (within 5 cents); filter centre untouched, fully closed cuts by
  more than 60 dB, the passband stays within 3.5 dB.
- **Not verified:** how loops, CUE and the filter sound and feel (owner, with the deck screen).
- **Commit:** 0058d42

### 2026-10-10 06:41 — M3: Library screens — explorer, track table, menus, drag & drop, crates, Automix queue
- **Added:** the library screen under the two decks, in three resizable columns:
  - **Explorer:** Music Library, Music / Downloads / Home, every drive (USB sticks and network
    drives too) as a folder tree that opens one level at a time; Crates & Playlists (create,
    rename F2, delete Del, right-click menu); Import Files / Import Folder / Import M3U.
  - **Track table:** shows only the rows on screen, so 50,000 tracks scroll smoothly. Columns
    Title, Artist, Remix, Length, BPM, Key, Plays, Last played (right-click the header to show
    Album, Genre, Year, Rating; the choice is saved). Search box (Ctrl+F). Hover buttons per
    row: A · B · ⚡ (Automix) · ⋮ (menu). Analyze / Import / Clear search buttons.
  - **Automix queue:** drop tracks, files or folders on it, reorder by dragging, select,
    remove (Del), shuffle, clear; total length shown. (Starting Automix comes in M5.)
- **Added:** multi-select with click, Ctrl+click, Shift+click, Ctrl+A, Esc and the arrow
  keys; the number of selected tracks is shown under the table.
- **Added:** our own right-click menu. Submenus open on hover and with the → key; ← or Esc
  closes them. Every action applies to the whole selection and says how many tracks it affects
  ("Add 3 tracks to Automix"); with several tracks selected, "Load to Deck A" names the one it
  will load. Batch Operations ▸ (analyze, double/halve/set BPM, rating) and File Operations ▸
  (Show in Explorer, copy paths). Remove from library asks first. The table never empties
  while an action refreshes it.
- **Added:** drag & drop that works on Windows (pointer events, not the browser's drag & drop,
  which Tauri switches off — the reason the old app's drag & drop never worked): table rows →
  Deck A / B, Automix, a crate; files from Windows Explorer → Deck A / B, Automix, a crate;
  a folder from Explorer → folder tree (opens it) or Automix (adds everything in it). A label
  follows the mouse and the target lights up; Esc cancels.
- **Added:** a first version of the decks (title, artist, time, play/pause, drop target);
  the full decks come in M4. Keyboard: Enter / Shift+Enter load to Deck A / B, Q adds to
  Automix, F1 / F5 play-pause deck A / B, Ctrl+L opens the Music Library.
- **Added:** errors from Rust appear as red messages instead of failing silently.
- **Fixed (found by the checks before commit):** a lost backslash in two path patterns would
  have broken Windows paths in drag & drop; two buttons both called "Clear" got clear names;
  table columns no longer spill over the Automix panel in a narrow window.
- **Tests:** 40 interface tests pass, including — folder tree lists drives incl. USB and opens
  lazily; 50,000-track folder renders under 80 rows; click/Ctrl/Shift/Ctrl+A/Esc/arrow
  selection; submenus open on hover and with →, close on ←/Esc and when another item is
  hovered; actions reach all selected tracks; row count stays 40 throughout a menu action;
  crates create/rename/delete; every drag & drop case in the plan (rows → decks / queue / crate,
  Explorer files → decks / queue, Explorer folder → tree / queue, queue reordering, Esc
  cancels, a click is not a drag). Also checked by hand in a browser with the stand-in data.
- **Not verified (owner, on the bar PC):** drag & drop with the real mouse inside the app and
  from Windows Explorer; right-click menus; import dialogs; Show in Explorer; a real 50,000-file
  library.
- **Commit:** d415af5

### 2026-10-10 06:41 — M3: App connects the window to the engine and the library
- **Added:** when the app starts it opens the library database in the app's data folder,
  starts the audio engine on the preferred sound card (if one is saved) or the default one,
  and sends the screen the state of both decks about 60 times a second (position, tempo,
  key lock, cues, how far decoding has got, decoding errors, which device is playing).
- **Added:** commands the screen can use: browse drives and folders, read a folder's tracks,
  the Music Library, import files/folders, crates and playlists, M3U import, BPM/key analysis
  (on a separate database connection so the library stays usable meanwhile), ratings, manual
  BPM, play counts, load a track or a dropped file onto Deck A/B (saved hot cues come back),
  all deck and mixer controls, the Automix queue (add, insert, move, remove, clear, shuffle),
  "Show in Explorer", and saved settings.
- **Added:** file-picker dialogs (Tauri dialog plugin, MIT/Apache-2.0) for Import Files /
  Folder / M3U.
- **Tests:** 5 app tests pass (queue add/insert/move/remove/shuffle, same track queued twice,
  command parsing); the full Rust test suite passes.
- **Not verified:** the complete app on the bar PC (see the M3 screens entry).
- **Commit:** 5a15523

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
- **Commit:** 71d7c37

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
