# BongPlayer — Plan v2

Music player for a bar: runs unattended through the day (Automix), and a resident DJ
takes over at night (decks, platters, Pioneer DDJ-400). Windows 10/11 x64.

This replaces the old `ImplementationPlan.md`. The visual direction (dark glass,
glowing platters, 3-column dock, Automix cockpit) is kept as shown in the reference
recording. What changes is the engine, the build order, and that **every feature has a
pass/fail test** so nothing is silently dropped again.

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
│  → deck → channel strip (trim, 3-band EQ, kills, filter) │
│  → crossfader → master (duck, limiter) → cpal/WASAPI     │
│  sampler bus, radio source, automix controller           │
│  offline renderer (same graph → WAV) for tests           │
├──────────────────────────────────────────────────────────┤
│ crates/library  SQLite (rusqlite): tag cache, cues,      │
│ playlists, settings, resume state                        │
└──────────────────────────────────────────────────────────┘
```

**Audio never runs in the webview.** The UI only sends commands ("play A", "EQ low −6 dB")
and draws what the engine reports. This is what makes scratching, key lock, exact cue
jumps and 10+ hour stability possible.

Dependencies to confirm during spikes: `symphonia` (decode), `rubato` (resample),
a time-stretcher (Signalsmith Stretch or Rubber Band — chosen by listening test in M2),
`cpal` (WASAPI output), `midir` (MIDI), `rusqlite`, `reqwest` (radio).

## 2. Decisions that fix the old app's failures

| Problem in old app | Decision |
|---|---|
| Drag & drop didn't work | On Windows, Tauri's native file-drop handler disables the webview's HTML5 drag & drop. So: native drop **only** for files from Explorer; **internal** dragging (table → deck / queue) uses a pointer-event drag layer, not HTML5 DnD. |
| No select-all / bulk right-click | Table has real multi-select (click, Ctrl, Shift, Ctrl+A, Esc). Context menu acts on the whole selection. |
| Radio didn't work | Radio is a Rust source: resolves `.pls` / `.m3u` / redirects / PHP endpoints, reads ICY metadata, reconnects with backoff. A URL that returns an HTML page is detected and reported clearly instead of failing silently. |
| BPM errors (e.g. 163 vs ~82) | Read BPM/key from tags first; analyse only tracks that are queued or loaded; fold half/double-tempo results into a sane range; allow manual override and tap-tempo. |
| Hardcoded `C:/D:/E:` file scope | Rust reads files; no path scope list. Any drive, USB, network share. |
| Features planned but missing | Milestone acceptance tests (section 4). A milestone is not done until its tests pass. |

## 3. Cross-cutting requirements

- **Never dead air.** Watchdog: if a deck stalls, a file is missing/corrupt, or the output
  device vanishes, skip to the next track / reopen the default device / keep the queue.
- **Resume after crash or reboot.** Queue, current track and position are persisted; optional
  auto-start on Windows login.
- **Lock mode.** One toggle locks transport, skip, load, crossfader and queue edits (staff
  can't skip by accident). Unlock via a held button or PIN. Volume stays adjustable (configurable).
- **Library scale (~50,000 files).** Browse folders on demand — never scan everything at
  once. SQLite caches tags per file; the table is virtualised; search is instant over the
  current folder / playlist. A night's playlist is just a list built from folders.
- **Universal UI protocols** (kept from v1): tooltips with shortcuts on every control,
  global context menus, drag & drop to every valid target, reset-to-default on right-click
  for knobs/sliders.
- **One sound card for now.** Engine has master and cue buses; v1 outputs master only.
  Headphone cue on a second device (DDJ-400's own audio interface, likely needs its ASIO
  driver) is a later milestone.

## 4. Milestones and acceptance tests

Each line is a test. "A" = automated (cargo/vitest), "M" = manual check on a real PC.

### M0 — Scaffold & CI
- A: Cargo workspace + Tauri v2 + React 19 + TS + Vite + Tailwind; `cargo test`, `tsc --noEmit`, `vitest` run in CI.
- A: GitHub Actions builds a Windows NSIS installer and uploads it as an artifact.
- M: Installer runs, window opens with the app shell.

### M1 — Engine core (no UI)
- A: Decode mp3 / flac / wav / m4a / ogg; duration and sample rate correct.
- A: Offline render of a deck at 0% pitch is bit-accurate to the source (within resampler tolerance).
- A: Seek to T lands within 1 ms; hot-cue jump within 1 ms.
- A: 3-band EQ frequency response within 0.5 dB of spec; kill switches reach ≤ −60 dB.
- A: Crossfader is constant-power (A² + B² = 1 across the travel).
- A: Limiter never exceeds ceiling on a clipping test signal.
- A: Output device lost → engine reopens default device without panicking.

### M2 — Decks, pitch, key lock, scratch
- A: ±8 / 16 / 50 % pitch changes speed correctly; key lock keeps pitch within 5 cents.
- A: Scrub input (jog) produces audio that follows the position, forward and reverse.
- M: Listening test of stretcher candidates; pick one.
- M: Platter scratch feels right on a real mouse / DDJ-400 jog.

### M3 — Library & drag/drop (the old app's gaps)
- A: Folder tree lists drives (incl. USB), expands lazily; 50,000-file folder tree opens in < 1 s.
- A: Tag cache hit avoids re-reading files; table virtualised (renders only visible rows).
- A: **Multi-select:** click, Ctrl+click, Shift+click, Ctrl+A, Esc; selection count shown.
- A: **Right-click on a selection** → Load A / Load B / Add to Automix / Add to playlist / Remove / Analyze / Show in Explorer, applied to all selected.
- A+M: **Drag & drop**, each of:
  - table row(s) → Deck A, Deck B, Automix queue
  - Explorer file(s) → Deck A, Deck B, Automix queue
  - Explorer folder → folder tree (navigates) and Automix queue (enqueues contents)
  - reorder rows inside the Automix queue
- A: Playlist import: `.m3u` / `.m3u8` (relative + absolute paths, missing files flagged).

### M4 — Mixer & waveforms
- Channel strip UI, bipolar filter, VU meters, crossfader, master, tooltips everywhere.
- A: Meter values from the engine match offline-render RMS.
- M: Scrolling beat waveforms at 60 fps with playhead and cue flags; overview waveform seeks on click.

### M5 — Automix (daytime mode)
- A: Transitions (Smooth, Bass Swap, Cut, Echo-Out) render correctly offline; no gap > 0 ms between tracks in Smooth.
- A: Trigger threshold / crossfade time honoured; Loop, Shuffle, Auto-remove behave as labelled.
- A: Missing / corrupt next track is skipped; queue continues.
- A: Queue and position restored after simulated crash.
- M: 12-hour soak test on the bar PC with a real playlist.
- Lock mode (section 3) and the simple daytime view (big Now Playing / Next / Volume / Duck).

### M6 — Radio
- A: Fake local Icecast server (in tests) covers: plain MP3, AAC, redirect, `.pls`, `.m3u`, ICY title changes, mid-stream disconnect → reconnect.
- A: HTML page URL → clear "this is a web page, not a stream" message.
- M: Both real stations from the old app (see section 6) play and show song titles.
- Radio works as a deck source and as an Automix item.

### M7 — Extras, one at a time
Hot cues (8, colour-coded, saved per track) · Sampler (8 pads, ducking, choke groups) ·
Karaoke / synced lyrics (LRCLIB) · Themes (Midnight Slate, Pioneer Stealth, Technics Silver,
Day Shift) · **Pioneer DDJ-400 MIDI profile** (via `midir` in Rust: jog / pitch / EQ /
faders / pads / LEDs) · headphone cue on a second device.

## 5. How this is verified

- Cloud environment is Linux and cannot play or hear audio. The engine is therefore built
  as a library with an **offline renderer**; tests check levels, timing and spectra from
  rendered WAVs.
- UI behaviour (drag & drop, selection, menus) gets automated browser tests where possible.
- Anything involving real speakers, WASAPI, the DDJ-400, or the actual radio streams needs a
  manual check on the bar PC. Those are marked **M** above and I'll say plainly which ones
  I have not been able to verify.

## 6. Open items

- Radio stations to test against (from the old app):
  - `https://streaming.bravo.hr/player/player.html?stream=0` — this is a **web page URL**,
    not an audio stream; the real stream URL needs to be discovered (M6 will do this).
  - `http://live.radiodalmacija.hr/radio.php` — likely redirects to the real stream.
- Which sound card the bar PC uses, and how the DJ routes audio (PC → bar mixer, or
  through the DDJ-400's own audio).
- HLS (`.m3u8`) radio streams: not in v1.
- Nothing from the old app needs migrating (no saved playlists or stations).
