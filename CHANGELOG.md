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

### Fixed
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
