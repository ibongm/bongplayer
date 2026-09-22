# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Initial project structure and documentation
- AGENTS.md: Audio Architecture & Engineering Guidelines
- CLAUDE.md: Agent guidelines (synced with AGENTS.md)
- TODO.md: Phase tracking checklist
- ImplementationPlan.md: Master implementation plan
- **Phase 1**: Project Scaffolding & Tauri v2 Shell
  - Scaffolded Tauri v2 + React 19 + TypeScript + Vite app via `create-tauri-app` (identifier `com.bongplayer.app`)
  - Configured Tailwind CSS v3 + PostCSS with CSS-variable theming scaffold (`tailwind.config.js`, `src/index.css`, default Midnight Slate skin variables)
  - Configured `src-tauri/capabilities/default.json` (`core:default`, `dialog:default`, `fs:default`, `fs:allow-read-dir`, `fs:allow-read-file`, `fs:allow-stat`, `fs:scope` for `C:/**`, `D:/**`, `E:/**`)
  - Configured `assetProtocol.scope` in `src-tauri/tauri.conf.json` for local drive roots; added `protocol-asset` Cargo feature
  - Registered `tauri-plugin-fs` and `tauri-plugin-dialog` in `src-tauri/src/lib.rs`
  - Added `src/audio/context.ts` singleton `AudioContext` with `ensureAudioContextRunning`/`closeAudioContext`
  - Added `src/services/ipc.ts` (typed `invoke` wrapper) and `src/services/dialog.ts` (folder picker)
  - Added ESLint flat config + Prettier, `.github/workflows/ci.yml` (Windows-only, Node 20/22 matrix)
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run tauri dev` all pass; WebView2 window boots and renders correctly
- **Phase 2**: Modular Web Audio Graph
  - Added `src/audio/nodes/musicBus.ts` — per-deck −9 dB summing/ducking gain stage (`duck`/`restore`)
  - Added `src/audio/nodes/samplerBus.ts` — 8-voice sampler bus with independent per-voice gain
  - Added `src/audio/nodes/masterLimiter.ts` — `DynamicsCompressorNode` limiter (-0.5 dB threshold, 20:1 ratio) with emergency ducking (-80% over 200ms)
  - Added `src/audio/nodes/threeBandEQ.ts` — low-shelf/peaking/high-shelf 3-band EQ (-24 dB to +6 dB) with independent per-band kill switches
  - Added `src/audio/nodes/bipolarFilter.ts` — normalized single-knob LPF/HPF sweep
  - Added `src/audio/nodes/equalPower.ts` — constant-power crossfader (cosine law)
  - Added `src/audio/nodes/pflBus.ts` — headphone cue bus with split-cable (Master L / Cue R) and dual-soundcard (`setSinkId`) routing strategies
  - Added `src/audio/utils.ts` — shared dB/ramp/interpolation helpers enforcing AGENTS.md §5's ramp-not-direct-assignment rule
  - Added `src/audio/nodes/index.ts` barrel; re-exported from `src/audio/index.ts`
  - Added Vitest + `node-web-audio-api` (real `OfflineAudioContext` DSP rendering in Node) for null-testing every node; 20 tests across 7 node modules
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, and `npm run tauri dev` all pass
- **Phase 2.5**: Audio Decoding & Waveform Pipeline (Risk #2)
  - Added `src/audio/decode.ts` — `decodeAudioFile()`: browser `decodeAudioData` first (MP3/WAV/AAC/M4A), falling back to a Rust `decode_audio` IPC command for FLAC/OGG/Vorbis (formats WebView2 can't decode natively, per AGENTS.md §6)
  - Added `src-tauri/src/commands/audio.rs` — real `symphonia`-based decoder (FLAC/OGG/Vorbis/PCM/WAV), run on a blocking thread via `tauri::async_runtime::spawn_blocking`; 2 Rust unit tests decoding a real in-memory WAV signal
  - Added `src/audio/waveform.ts` — `extractPeaks()` (pure min/max-per-pixel scan) and `decodeAndExtractPeaks()` (decode + extract in one step, taking an explicit `BaseAudioContext` so it works from either the main thread or a worker)
  - Added `src/workers/waveform.worker.ts` — background decode + peak extraction via a throwaway `OfflineAudioContext` (Tauri IPC isn't reachable from a worker, so FLAC/OGG there report an error rather than silently failing); verified Vite's `?worker` import bundles it correctly (production `vite build` output inspected, then the scratch import reverted)
  - Added `src/components/waveforms/WaveformCanvas.tsx` — two-layer canvas (static waveform/hot-cues + a `requestAnimationFrame`-driven playhead overlay), so 60 FPS playhead motion never re-renders the component or repaints the waveform bars
  - `waveform.worker.ts` type-checks under the same DOM-lib `tsconfig.json` as the rest of the app (not a separate `WebWorker`-lib config — see Fixed), using a narrow local cast for `postMessage`/`addEventListener`'s worker-scope signatures
  - Added Vitest coverage: `extractPeaks` known-signal exact-value tests, `decodeAndExtractPeaks`/`decodeViaBrowser`/`decodeAudioFile` integration tests against real WAV bytes (via `node-web-audio-api`); 7 new tests (27 total)
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, `cargo test`, and `npm run tauri dev` all pass
  - `src-tauri/capabilities/default.json` intentionally left unchanged: Tauri v2's ACL/capabilities system governs plugin commands (`fs:*`, `dialog:*`), not app-defined `#[tauri::command]` functions registered via `generate_handler!` — confirmed against the auto-generated `src-tauri/gen/schemas/acl-manifests.json`, which lists no entries for the app's own commands
- **Phase 3**: Zustand State Slices
  - Added `src/store/createDeckStore.ts` — shared factory for the two structurally-identical deck stores (track metadata, playback state, current time, pitch/pitch-range, key lock, hot cues); `useDeckAStore.ts`/`useDeckBStore.ts` are one-line instantiations
  - Added `src/store/useMixerStore.ts` — per-deck channel strips (trim, 3-band EQ + kills, filter position, volume fader, PFL), crossfader position/curve, master/cue gain; setters clamp to the same ranges as the Phase 2 audio nodes (EQ -24..+6 dB, filter -1..1, faders 0..1)
  - Added `src/store/useLibraryStore.ts` — selected folder, scanned files, search query, column sort; exports `selectFilteredFiles()`, a reusable case-insensitive filter+sort selector
  - Added `src/store/useAutomixStore.ts` — play queue (`crypto.randomUUID()` ids), ping-pong status/active deck, transition style/duration, trigger threshold
  - Added `src/store/useSamplerStore.ts` — 8 fixed slots (file, label, gain trim, choke group 0-4)
  - Added `src/store/useUIStore.ts` — shift lock, theme, panel ratios, active context menu; `theme`/`panelRatios` persist to `localStorage` via zustand's `persist` middleware (partialized — shift lock and the context menu are momentary, not persisted)
  - Added `src/types/deck.ts` — `DeckId`/`EqBand`/`SlotIndex`, the first use of the previously-empty `src/types/` folder from AGENTS.md §3's architecture. Note: `src/services/midi/types.ts` independently defines its own `DeckId`/`PadIndex` with the same values — left as-is (out of scope for this phase) rather than refactoring another module as a side effect; worth reconciling when the MIDI layer gets wired to these stores
  - All 6 stores use zustand's `devtools` middleware (named actions, no extra dependency — both `devtools` and `persist` ship in the `zustand` package)
  - No `immer` dependency added: plain `set()` with explicit spreads was sufficient for these state shapes (AGENTS.md §7: avoid unnecessary third-party dependencies)
  - Added Vitest coverage for all 6 stores (action correctness, clamping, queue reordering, sort/filter behavior); 39 new tests (66 total)
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, and `npm run tauri dev` all pass

- **Phase 3.5**: Automix Dead-Air Watchdog (Risk #4)
  - Added `src/audio/nodes/silenceWatchdog.ts` — `createSilenceDetector()` (pure, tested persistence logic: RMS level + grace period) wrapped by `createSilenceWatchdog()` (an `AnalyserNode` + `setInterval` poller); the fallback *action* itself (e.g. skip to the next automix track) is Phase 7's `automixController.ts` to wire up — this phase only builds the detection primitive
  - 5 new tests on the pure detector logic (71 total); the `AnalyserNode`/timer wiring is intentionally left untested directly, same reasoning as `waveform.worker.ts`'s thin wrapper — `AnalyserNode` readings are only meaningful against a live real-time `AudioContext`, which `OfflineAudioContext`-based testing can't exercise
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test` all pass

- **Phase 4**: Universal Tooltips, Context Menus & Drag-and-Drop
  - Added `src/components/common/Tooltip.tsx` — 150ms-delay, viewport-aware glassmorphic tooltip (flips below the anchor / clamps horizontally when it would overflow)
  - Added `src/components/common/ContextMenu.tsx` + `contextMenuTargets.ts` — a single global context menu, mounted once in `App.tsx`, that suppresses the native OS menu everywhere and renders real, working actions resolved from a `ContextMenuTarget` union (`deck`, `trackRow`, `automixRow`, `knob`, `samplerSlot`), wired directly to the Phase 3 stores (not stubs) — e.g. "Clear/Eject Track" actually calls `clearTrack()`, sampler choke-group items actually call `setChokeGroup()`
  - Revised `useUIStore`'s `ActiveContextMenu` from `{x, y, targetId: string}` to `{x, y, target: ContextMenuTarget}` — Phase 3 left `targetId` as an opaque placeholder string pending this phase's real design; a structured union is safer than string-parsing
  - Added `src/services/trackLoader.ts` — `loadTrackMetadata()`: reads a file via `@tauri-apps/plugin-fs`, decodes it via Phase 2.5's `decodeAudioFile()`, and returns deck-ready `TrackMetadata` (title defaults to filename; no tag reading yet)
  - Added `src/services/dragAndDrop.ts` — internal HTML5 track-drag protocol (`beginTrackDrag`/`allowTrackDrop`/`readTrackDrop`) plus a native-OS-file-drop registry (`registerDropZone`/`setDropZoneHandler`/`initNativeFileDropListener`, using the real `@tauri-apps/api/webview` `onDragDropEvent` API) that later phases' Deck/Automix/FolderTree components register against — initialized once in `App.tsx`
  - Added `@tauri-apps/plugin-opener` (+ `tauri-plugin-opener` Rust crate, `opener:default`/`opener:allow-reveal-item-in-dir` capabilities) for "Show in File Explorer", the one context-menu action needing a new plugin
  - Added 15 new tests (86 total) covering the resolver's real store-wiring and the internal drag protocol's payload validation; the Tauri-IPC-dependent branches (load-to-deck, reveal-in-explorer, native OS drop) are left untested directly, same reasoning as Phase 2.5's Rust fallback — no working Tauri bridge exists in the Vitest/Node environment
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, `cargo build`, and `npm run tauri dev` all pass

- **Phase 5**: Resizable 3-Column Lower Bay
  - Added `src/hooks/useResizablePanels.ts` — pointer-driven splitter dragging with `computeDraggedRatios()` extracted as pure, unit-tested ratio math (min 160px left / 220px right, enforced via `useUIStore`'s already-persisted `panelRatios` from Phase 3)
  - Added `src/components/common/SplitterHandle.tsx` — draggable divider, double-click resets to 20/55/25
  - Added `src/components/library/folderScanner.ts` + `FolderTree.tsx` — real OS folder tree (`@tauri-apps/plugin-fs` `readDir`/`@tauri-apps/api/path` `join`, no manual path string concatenation per AGENTS §6) rooted at the `fs:scope`-permitted `C:\`/`D:\`/`E:\` drives; selecting a folder scans it for audio files into `useLibraryStore`
  - Added `src/components/library/TrackTable.tsx` — hand-rolled virtualized list (no new dependency — only visible rows + overscan are mounted), wired to `selectFilteredFiles`, sortable headers, drag-to-internal-target rows, real context-menu integration
  - Added `src/components/library/AutomixPanel.tsx` — queue display, transition-style picker, start/pause/stop/clear, both native-OS-file-drop and internal-track-drop targets
  - Added `src/components/layout/LowerBay.tsx` tying the three panels together; wired into `App.tsx` (restructured to a full-height flex layout so the lower bay actually has real height to render into — the deck/mixer/waveform rows above it are Phase 6's job)
  - Extended `useAutomixStore`'s `AutomixQueueEntry` with `durationSeconds: number | null` (+ `setEntryDuration` action) and added `src/services/automixEnqueue.ts` (`enqueueTrackWithDuration`) — Phase 3's entry shape had no way to show the queue's "total time," a gap only visible once the actual panel needed to render it; both the panel's native-drop handler and `contextMenuTargets.ts`'s "Add to Automix" action now go through this
  - Added 9 new tests (93 total) for `computeDraggedRatios`' pure ratio math and the automix duration wiring
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, and `npm run tauri dev` all pass — visually confirmed via screenshot (folder tree, track table, and automix panel all render with correct proportions)

- **Phase 6**: Decks, 60 FPS Platters & Center Mixer
  - **Real audio graph assembly** — Phase 2's node modules were built but never wired together end to end; this phase does that:
    - Added `src/audio/deckEngine.ts` — per-deck playback (Trim -> musicBus -> EQ -> filter -> volume fader), recreating `AudioBufferSourceNode` per play/pause/seek (the standard pattern — Web Audio has no native pause), with position tracked via `(startedAtContextTime, startOffsetSeconds)` since there's no native "current position" API
    - Added `src/audio/masterGraph.ts` — the lazily-constructed singleton wiring both deck engines -> crossfader -> master limiter -> master gain -> destination, with the sampler bus tapped pre-limiter and a real stereo VU tap (`ChannelSplitterNode` + 2 `AnalyserNode`s — a single analyser only exposes a downmixed view)
    - Added `src/audio/samplerEngine.ts` — per-slot buffer cache + choke-group-aware triggering through Phase 2's `samplerBus`
    - Extended `deckEngine` with trim/volume-fader `GainNode`s and `equalPower.ts`'s `setPosition()` with an optional `curve` parameter (reusing `audioMath.ts`'s `crossfaderGains()`) — both were gaps flagged after Phase 2/5: `useMixerStore` already had `trimDb`/`volumeFader`/`crossfaderCurve` fields with no audio node to apply to
    - Extended `trackLoader.ts`'s `decodeTrack()` to return the decoded `AudioBuffer` alongside metadata (Phase 4's `loadTrackMetadata` discarded it after reading `.duration`) — needed for actual deck playback
  - Added `src/hooks/useDeckController.ts` and `useMixerController.ts` — the React-facing bridges between the pure Phase 3 stores and the real engine/graph; **Key Lock is stored/toggleable but not implemented in audio** — true key lock needs a time-stretching DSP algorithm (phase vocoder or similar) this codebase doesn't have; the pitch fader always affects speed and pitch together rather than faking correct-sounding-but-wrong behavior
  - Added `src/components/deck/{JogWheel,PitchSection,CuePadMatrix,DeckPanel}.tsx` — direct-DOM `requestAnimationFrame` platter rotation (33⅓ RPM) with pointer-based scrubbing, a vertical pitch fader with center detent + momentary bend buttons, and an 8-pad hot-cue/sampler matrix (sampler loading via a new `openAudioFileDialog()` in `services/dialog.ts`)
  - Added `src/components/mixer/{ChannelStrip,CenterMixer}.tsx` — full channel strips (trim/EQ+kills/filter/PFL/fader) and stereo VU meters + crossfader + a "master" transport bar (interpreted as driving both decks together — the spec doesn't define a single shared transport concept beyond this component)
  - Added `src/audio/waveform.ts`'s `windowPeaks()` — pure, tested windowing math for `ScrollingWaveforms.tsx`'s fixed-center-playhead style (distinct from `WaveformCanvas`'s Phase 2.5 default of a static waveform with a moving playhead line); the window's position shifts near the track start/end rather than padding with fake silence, so the playhead visibly de-centers there
  - Added `src/components/waveforms/ScrollingWaveforms.tsx` and `src/components/layout/DeckMixerRow.tsx`, wired into `App.tsx` alongside the Phase 5 `LowerBay` for the full VirtualDJ-style layout
  - Added 5 new tests (100 total) for `windowPeaks` and the `equalPower` curve parameter; `deckEngine.ts`'s real-time playback-offset math is intentionally not unit tested (needs actual wall-clock time to advance, which `OfflineAudioContext` doesn't do) — verified instead via the running app
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, and `npm run tauri dev` all pass — visually confirmed via screenshot: dual jog wheels, deck transport, full channel strips, center mixer, and the lower bay all render correctly with the audio graph wired end to end

- **Phase 6.5 (MIDI Hot-Plug Support, Risk #5)**
  - Added `src/services/midiAccess.ts` — `requestMIDIAccess()` + `statechange` listening for real hot-plug (devices attached/detached at any time, not just at startup), matching each connected input's name against known profiles (currently just the DDJ-400) and wiring its `midimessage` events through the existing (concurrently-contributed) `src/services/midi/parser.ts`
  - Added `src/services/midiDispatch.ts`'s `applyDeckAction()` — turns the parser's controller-neutral `DeckAction`s into real store/engine calls (play/pause toggle on the press edge, pitch/eq/filter/crossfader/volume value mapping, jog-to-seek, hot cue/sampler triggering); previously the MIDI decode layer existed but had nothing wired to actually act on its output
  - Added `src/services/padActions.ts` (`activateHotCue`/`activateSamplerSlot`) — extracted from `CuePadMatrix.tsx` so hot-cue/sampler-pad behavior has one implementation shared by mouse clicks and MIDI hardware, rather than two that could drift
  - **Major test-infrastructure addition**: `src/testSetup.ts` polyfills `globalThis.AudioContext`/`OfflineAudioContext` with `node-web-audio-api`'s real-time implementation (verified empirically: `currentTime` genuinely advances with wall-clock time). This unlocks real tests for anything touching `getAudioContext()`'s singleton — previously undocumented/untestable, including Phase 6's own `deckEngine.ts`: added `src/audio/deckEngine.test.ts`, 10 wall-clock tests covering play/pause/seek/stop/rate-change/buffer-swap, all passing
  - Added 8 tests for `applyDeckAction`; 18 new tests total (118 total)
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, and `npm run tauri dev` all pass
  - **Known platform limitation**: WebView2 currently rejects `requestMIDIAccess()` with `NotAllowedError` outright in this environment — handled gracefully (a console warning, not a crash), but real MIDI hardware testing isn't possible without a WebView2/Windows configuration that grants it. The decode/dispatch pipeline is otherwise complete and unit-tested independent of live hardware

- **Phase 6.5 (Keyboard Shortcuts & Accessibility, Risk #7)**
  - Added `src/services/keyboardShortcuts.ts` — a deliberate, documented DJ-standard keymap (no single convention is universal across DJ software): Q/W near the left hand for Deck A play-pause/cue, U/I mirrored near the right hand for Deck B, number row split 1-4 / 7-0 for hot cues, CapsLock for Shift Lock; `resolveShortcut()` is pure and fully unit tested
  - Added `src/hooks/useKeyboardShortcuts.ts`, mounted once in `App.tsx` — ignores keydowns from text-entry targets (so typing in the track search box doesn't trigger shortcuts) and drives the same `useDeckController`/`padActions`/`useUIStore` calls the UI itself uses
  - `ContextMenu.tsx`: added real focus management — the menu takes focus on open (first enabled item), Up/Down/Home/End navigate between items, and focus returns to whatever triggered the menu on close (previously: click/Escape only, no keyboard navigation or focus restoration)
  - `JogWheel.tsx`: added `role="slider"` + `aria-valuemin/max/now` (updated via direct DOM mutation in the same rAF tick as the rotation, not a React re-render — subscribing to `currentTimeSeconds` for this would reintroduce the 60fps re-render cost the whole component is designed to avoid) and an ArrowLeft/ArrowRight keyboard seek alternative to pointer scrubbing
  - Added `aria-pressed` to `PitchSection`'s Key Lock and `ChannelStrip`'s EQ kill/PFL toggle buttons; `aria-label`s on `CuePadMatrix`'s hot-cue/sampler pads describing their current state; `CuePadMatrix`'s mode switch changed from plain buttons to `role="tablist"`/`role="tab"`/`aria-selected`, matching its actual UI pattern
  - Added 7 new tests (125 total) for `resolveShortcut`; `isTypingTarget` isn't unit tested directly — it depends on the real `HTMLElement`/`document` globals, which the Node test environment doesn't have (no jsdom installed)
  - Verified: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run test`, and `npm run tauri dev` all pass
  - **Scope note**: this pass covers the highest-traffic custom widgets (context menu, jog wheel, the toggle/tab controls above); native `<button>`/`<input type="range">` elements used throughout already carry solid baseline accessibility from semantic HTML and weren't individually retrofitted — a full accessibility audit across every component is future work, not attempted here given the scope of the remaining phases

### Fixed
- `pflBus.ts`: `createPflBus`'s existence-check for `createMediaStreamDestination` wasn't enough — `node-web-audio-api`'s `AudioContext` (used for testing, see above) declares the method but throws when actually called (unimplemented server-side); wrapped the call in try/catch so an incomplete-but-present implementation degrades the same as a missing one, rather than crashing
- `midiAccess.ts`: `requestMIDIAccess()` rejecting (e.g. `NotAllowedError`) was an unhandled promise rejection, observed live in `npm run tauri dev`; wrapped in try/catch alongside the existing "API doesn't exist" guard
- `ScrollingWaveforms`: initial implementation used `useEffect` + `setState` to derive peaks from the deck's buffer, flagged by React 19's stricter `eslint-plugin-react-hooks` rule (synchronous setState in an effect risks cascading renders) — this is a pure derivation from `[deck, track]`, so it belongs in `useMemo`, not an effect; fixed before ever running
- `TrackTable`: passing `selectFilteredFiles` directly as a zustand selector (`useLibraryStore(selectFilteredFiles)`) returns a new array reference on every call, which `useSyncExternalStore` reads as "state changed" every render — an infinite update loop, actually hit and observed live in `npm run tauri dev` ("Maximum update depth exceeded"). Fixed by selecting the raw fields individually and computing the filtered/sorted list via `useMemo`; `selectFilteredFiles`'s parameter type narrowed from full `LibraryState` to just the fields it needs, documented with the pitfall so it isn't reintroduced
- `useResizablePanels`: `handlePointerUp` referenced itself (`window.removeEventListener("pointerup", handlePointerUp)`) inside its own `useCallback` initializer, caught by `eslint-plugin-react-hooks`'s immutability rule before it ever ran; restructured to create both pointer handlers as closures local to each `beginDrag()` call instead
- `threeBandEQ`: per-band kill switches were wired to gate the downstream node in the series filter chain, so killing the low band silenced the mid/high bands too; fixed to floor only that band's own filter gain, verified by a test asserting a high-frequency tone survives a low-band kill
- Initial approach for typechecking `waveform.worker.ts` used a separate `tsconfig.worker.json` with the `WebWorker` lib, on the assumption it would include Web Audio API types — it doesn't (only `DOM` lib defines `AudioBuffer`/`OfflineAudioContext`/etc.), so this was replaced with a single-tsconfig approach using a local type cast at the one call site that needs the worker-scope `postMessage`/`onmessage` signatures
- `useLibraryStore`'s `selectFilteredFiles()` sort compared raw (case-sensitive) string values despite being documented as case-insensitive, so "apple" sorted after "Banana"/"Cherry"; caught by its own test, fixed by lowercasing string values before comparison
- Any other bug fixes during the phase

### Changed
- Breaking changes or migrations

### Security
- Security-relevant changes

---

## [0.0.0] - 2026-09-22

### Added
- Project initialization
- Core architecture documentation
