# BongPlayer — Plan v2.1

Music player for a bar: runs unattended through the day (Automix), and a resident DJ
takes over at night (decks, platters, Pioneer DDJ-400). Windows 10/11 x64.
Mouse and keyboard only (no touchscreen).

This replaces the old `ImplementationPlan.md`. Every feature has a pass/fail test, so
nothing is silently dropped again (the old app shipped without working drag & drop,
hover submenus, and radio).

**Visual references (provided by the owner):**
- Dark-glass skin: the old app's best-looking screenshot (glowing platters, dark panels).
- Structure: a VirtualDJ-style layout (top waveforms, two decks around a center mixer,
  browser + Automix dock). We borrow the *layout and features*, not VirtualDJ's logo,
  artwork or name.

---

## 1. Architecture

```
┌────────────── React 19 + TS UI (WebView2) ──────────────┐
│ views, canvases, drag/drop, context menus, lock screen   │
│ sends commands ▲                    ▼ receives events    │
└───────────────┼─────────────────────┼────────────────────┘
        Tauri v2 commands        Tauri events (meters, positions ~60 Hz,
                │                waveform peaks as binary)
┌───────────────┴─────────────────────┴────────────────────┐
│ src-tauri  (thin glue: commands, window, file drop, MIDI)│
├──────────────────────────────────────────────────────────┤
│ crates/engine  (pure Rust, no Tauri, unit-testable)      │
│  decode (symphonia) → resample → time-stretch/pitch      │
│  → deck → channel strip (trim, 3-band EQ, kills, filter, │
│  effects) → crossfader → master (duck, limiter) → cpal   │
│  sampler bus, radio source, automix controller           │
│  offline renderer (same graph → WAV) for tests           │
├──────────────────────────────────────────────────────────┤
│ crates/library  SQLite (rusqlite): tag cache, analysis,  │
│ cues, crates/playlists, covers/metadata cache, settings, │
│ resume state                                             │
└──────────────────────────────────────────────────────────┘
```

**Audio never runs in the webview.** The UI only sends commands ("play A", "EQ low −6 dB")
and draws what the engine reports. This is what makes scratching, key lock, exact cue
jumps and 10+ hour stability possible.

Dependencies to confirm during spikes: `symphonia` (decode), `rubato` (resample),
a time-stretcher (Signalsmith Stretch or Rubber Band — chosen by listening test in M2),
`cpal` (WASAPI output; ASIO only if the headphone spike in M2 needs it), `midir` (MIDI),
`rusqlite`, `reqwest` (radio, internet lookup).

## 2. Layout (reference: owner's screenshot + VirtualDJ-style structure)

Three views, switched by tabs at the top: **STANDARD**, **DECKS** (larger decks), **LIBRARY**
(mini decks A/B across the top, large track table, queue beside it).

- **Top bar:** logo, venue clock, view tabs, shortcut hints, **LOCK**, **DUCK**,
  **⚙ Settings (top right)**, engine status pill.
- **Collapsible strips under the top bar:** Sampler (8 pads) and Radio (name, URL, load to A/B, Save, Presets).
- **Top waveforms:** both decks, big A / B markers, centered playhead, cue flags.
- **Deck:** title/artist, info block (BPM, KEY, GAIN, REMAIN, TOTAL, TAP), overview waveform,
  Loop panel (auto-loops 1–32, IN / OUT, adjust, exit), Effect panel (effect picker + STR / SPD knobs),
  Pads (Hot Cues 1–8 / Sampler), platter, pitch fader (range 8 / 16 / 50 %, Key Lock, KEY shift, reset),
  pitch bend − / +, **CUE · PAUSE · PLAY · CUP · SYNC**.
- **Center mixer:** tabs **MIX | KARAOKE** at the top (above the master controls), **LRC** button,
  per-channel gain, 3-band EQ with kill buttons, filter, headphone CUE A / CUE B, level meters,
  channel faders, master / output, crossfader, master PLAY / PAUSE / STOP.
- **Dock (resizable 3 columns):**
  1. Explorer: drives, Music Library, Downloads, user home, **Crates & Playlists**, Import Files/Folder, Import M3U.
  2. Track table: cover thumbnail, Title, Artist, Remix, Length, BPM, Key, play count, last played
     (columns configurable); search box; hover buttons per row **A · B · ⚡ (Automix) · ⋮**;
     Analyze / Import / Clear.
  3. Tabs **Automix | Info**. Automix cockpit (start/stop, trigger threshold, crossfade time, style,
     Loop / Auto-remove / Shuffle / Clear, staged queue, total length). Info panel (cover, rating,
     year, album, genre, first seen, last played, play count).
- **Readability (mouse/keyboard):** minimum text size 11 px, full window width used (no wasted
  side margins), every control has a tooltip with its shortcut and a keyboard path.

## 3. Decisions that fix the old app's failures

| Problem in old app (seen in recordings) | Decision |
|---|---|
| Drag & drop did not work at all | On Windows, Tauri's native file-drop handler disables the webview's HTML5 drag & drop. So: native drop **only** for files from Explorer; **internal** dragging (table → deck / queue / crate / queue reorder) uses a pointer-event drag layer, not HTML5 DnD. |
| Right-click submenus (Batch / File Operations) didn't open on hover | Context menus are our own component: hover and → key open submenus; tested. |
| Menu ambiguity ("Load to Deck A" with 500 selected) | With multiple selected, Load to Deck is disabled (or loads the focused row — shown in the label). Bulk actions say how many tracks they affect. |
| Table briefly showed "0 tracks" after a menu action | Table state is never cleared by actions; test asserts row count is stable. |
| Radio didn't work (one URL was a web page, not a stream) | Radio is a Rust source: resolves `.pls` / `.m3u` / redirects / PHP endpoints, reads ICY metadata, reconnects with backoff. A URL returning an HTML page is detected and explained instead of failing silently. |
| Waveform stuck on "ANALYZING TRACK…", Deck A's top strip blank | Waveform peaks computed in Rust; a deck never shows an endless spinner: progress, then result or a visible error. |
| Analysis ~1 track/s; some BPMs wrong (e.g. 163 vs ~82 earlier; still doubtful values after) | Analysis in Rust, only for tracks that are loaded/queued/selected; tags first; half/double-tempo folding; manual override and TAP tempo. Target ≥ 5 tracks/s on the bar laptop (benchmark in M3). |
| Hardcoded `C:/D:/E:` file scope | Rust reads files; no path scope list. Any drive, USB, network share. |
| Features planned but not delivered | Milestone acceptance tests (section 5). A milestone isn't done until its tests pass. |
| Unexplained buttons (SANDBOX) | Dropped. VirtualDJ's Sandbox is a headphone-only practice mode; revisit only if wanted after headphone cue works (M11). |

## 4. Cross-cutting requirements

- **Never dead air.** Watchdog: if a deck stalls, a file is missing/corrupt, or the output
  device vanishes, skip to the next track / reopen the default device / keep the queue.
- **Output device handling.** At night the audio path is **Laptop → DDJ-400 → bar mixer**, so
  the DDJ-400's sound card is the output. App remembers the preferred device, switches to it
  when plugged in, and falls back to the default device if it disappears — without stopping the music.
- **Headphone cue.** The DJ pre-listens through the DDJ-400 headphone jack, which needs audio on
  the controller's second channel pair (probably the Pioneer ASIO driver). Verified by an early
  spike (M2), not left to the end.
- **Resume after crash or reboot.** Queue, current track and position are persisted; optional
  auto-start on Windows login.
- **Lock mode.** One toggle locks transport, skip, load, crossfader and queue edits (staff
  can't skip by accident). Unlock via a held button or PIN. Volume stays adjustable (configurable).
- **DUCK.** One button / shortcut lowers the music by a set amount with a smooth ramp, e.g. for
  announcements, and restores it on release/toggle. (Assumed meaning — confirm.)
- **Library scale (~50,000 files).** Browse folders on demand — never scan everything at once.
  SQLite caches tags per file; the table is virtualised; a night's playlist is a crate built from folders.
- **Internet features are optional and OFF by default** (Settings → Internet lookup):
  - covers & metadata: embedded art / `folder.jpg` first, then MusicBrainz + Cover Art Archive,
    Deezer/iTunes search as cover fallback; results cached, one lookup per track.
  - lyrics: LRCLIB (synced).
  - When on, artist/title are sent to those services; the setting says so.
- **Universal UI protocols:** tooltips with shortcuts on every control, global context menus,
  drag & drop to every valid target, reset-to-default on right-click for knobs/sliders.
- **Themes from day one:** all colours are CSS variables, so skins are data, not code.

## 5. Milestones and acceptance tests

"A" = automated (cargo / vitest / browser tests), "M" = manual check on a real PC.

### M0 — Scaffold & CI
- [x] A: Cargo workspace + Tauri v2 + React 19 + TS + Vite + Tailwind; `cargo test`, `tsc --noEmit`, `vitest` in CI.
- [x] A: GitHub Actions builds a Windows NSIS installer and uploads it as an artifact.
- [ ] M: Installer runs, window opens with the app shell.

### M1 — Engine core (no UI)
- A: Decode mp3 / flac / wav / m4a / ogg; duration and sample rate correct.
- A: Offline render of a deck at 0 % pitch matches the source within resampler tolerance.
- A: Seek to T lands within 1 ms; hot-cue jump within 1 ms.
- A: 3-band EQ response within 0.5 dB of spec; kills reach ≤ −60 dB.
- A: Crossfader is constant-power (A² + B² = 1 across the travel).
- A: Limiter never exceeds ceiling on a clipping test signal.
- A: Output device lost → engine reopens default device without panicking.

### M2 — Decks, pitch, key lock, scratch, output devices
- A: ±8 / 16 / 50 % pitch changes speed correctly; key lock keeps pitch within 5 cents.
- A: Scrub input (jog) produces audio that follows position, forward and reverse.
- A: Device hot-plug: preferred device appears → switch; disappears → fall back; no gap > 1 s.
- M: Listening test of stretcher candidates; pick one.
- M: **Headphone-cue spike:** can the app drive the DDJ-400 headphone channels (WASAPI vs ASIO)? Result decides M11 scope.
- M: Platter scratch feels right on mouse.

### M3 — Library, selection, menus, drag & drop, crates
- A: Folder tree lists drives (incl. USB), expands lazily; a 50,000-file library opens < 1 s.
- A: Tag cache hit avoids re-reading files; table virtualised.
- A: Analysis benchmark: ≥ 5 tracks/s; regression list of BPM/key values the old app got wrong
  (owner confirms true values: e.g. Come Together, Smells Like Teen Spirit, Johnny B. Goode).
- A: **Multi-select:** click, Ctrl+click, Shift+click, Ctrl+A, Esc; selection count shown.
- A: **Context menu on a selection:** Load A / Load B / Add to Automix / Add to crate / Batch Operations ▸ /
  File Operations ▸ (Show in Explorer, etc.) / Mark as Played / Remove — applied to all selected.
- A: **Submenus open on hover and with the → key**, close on Esc / leaving.
- A+M: **Drag & drop**, each of:
  - table row(s) → Deck A, Deck B, Automix queue, a crate in the explorer
  - Explorer file(s) → Deck A, Deck B, Automix queue
  - Explorer folder → folder tree (navigates) and Automix queue (enqueues contents)
  - reorder rows inside the Automix queue
- A: Row count never drops to 0 after a menu action.
- A: Crates & playlists create / rename / delete; `.m3u` / `.m3u8` import (relative + absolute paths, missing files flagged).

### M4 — Deck & mixer UI, waveforms, hot cues, loops
- Three views, top bar, collapsible strips, tooltips everywhere, Settings shell (⚙) with the Audio tab.
- A: Meter values from the engine match offline-render RMS.
- A: Hot cues 1–8 (set / jump / clear, saved per track); auto-loops 1–32, IN / OUT, exit loop; pitch bend.
- M: Scrolling beat waveforms at 60 fps for **both** decks; overview waveform seeks on click.
- A: A deck never shows an indefinite "analyzing" state (timeout → error message).

### M5 — Automix, Lock, DUCK, simple daytime view
- A: Transitions (Smooth, Bass Swap, Cut, Echo-Out) render correctly offline; no gap in Smooth.
- A: Trigger threshold / crossfade time honoured; Loop, Shuffle, Auto-remove behave as labelled.
- A: Missing / corrupt next track is skipped; queue continues.
- A: Queue and position restored after simulated crash.
- A: Lock blocks the listed actions; unlock via PIN / hold.
- M: 12-hour soak test on the bar PC with a real playlist.

### M6 — Radio
- A: Fake local Icecast server (in tests) covers: plain MP3, AAC, redirect, `.pls`, `.m3u`, ICY title changes, mid-stream disconnect → reconnect.
- A: HTML page URL → clear "this is a web page, not a stream" message.
- M: Both stations from the old app play and show song titles (see section 7).
- Radio works as a deck source and as an Automix item.

### M7 — Info panel, covers, internet lookup
- A: Embedded art and `folder.jpg` shown with no internet; covers cached.
- A: Internet lookup OFF by default; when ON, MusicBrainz / Cover Art Archive lookup fills missing fields once per track (tested against recorded responses).
- A: Info panel shows year, album, genre, rating, first seen, last played, play count.

### M8 — Karaoke (synced lyrics only)
- A: LRC parser (timestamps, multiple per line, offsets); local `.lrc`, embedded lyrics, LRCLIB (when internet is on).
- A: KARAOKE tab sits above the master controls; current line highlighted; click a line to seek the active deck.
- A: LRC button toggles the lyrics drawer.

### M9 — Sampler
- 8 pads (drop a file on a pad, file picker, choke groups, per-pad gain, saved), ducking of music while a sample plays.
- A: Sampler never routes through deck faders; ducks −9 dB over 50 ms, restores over 250 ms.

### M10 — Settings completion & skins
- ⚙ Settings tabs: Appearance (skins), Audio, Library, Automix defaults, Lock (PIN), Radio,
  Internet lookup, Keyboard shortcuts, MIDI.
- Skins: Midnight Slate (default dark glass), Pioneer Stealth, Technics Silver, Day Shift; skin
  import from a file. (No VirtualDJ skin.)
- A: Switching skin updates every colour live and persists; canvases redraw.

### M11 — DDJ-400, headphone cue, effects
- DDJ-400 MIDI profile via `midir` in Rust (jog, pitch, EQ, faders, pads, LEDs).
- Headphone cue on the DDJ-400, per the M2 spike result.
- Effects per deck (Flanger, Echo, Filter and similar; final set chosen then) with STR / SPD knobs.
- Optional: Sandbox (headphone-only practice mode), only if wanted.

## 6. How this is verified

- The cloud environment is Linux and cannot play or hear audio. The engine is therefore built
  as a library with an **offline renderer**; tests check levels, timing and spectra from
  rendered WAVs.
- UI behaviour (drag & drop, selection, menus, submenus) gets automated browser tests.
- Anything involving real speakers, WASAPI/ASIO, the DDJ-400, or the real radio streams needs a
  manual check on the bar PC. Those are marked **M** and I'll say plainly which I could not verify.

## 7. Open items

- Radio test stations (from the old app):
  - `https://streaming.bravo.hr/player/player.html?stream=0` — a **web page URL**, not an audio
    stream; the real stream URL needs to be discovered (M6).
  - `http://live.radiodalmacija.hr/radio.php` — likely redirects to the real stream.
- Sound card model on the bar PC, and how the DDJ-400 appears in Windows (one device or several,
  Pioneer ASIO driver installed?) — owner to check.
- Confirm DUCK meaning (lower music for announcements).
- Karaoke: lyrics only for now; microphone input / vocal reduction not planned.
- HLS (`.m3u8`) radio streams: not in v1.
- Nothing from the old app needs migrating (no saved playlists or stations).
