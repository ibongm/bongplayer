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

### Fixed
- `threeBandEQ`: per-band kill switches were wired to gate the downstream node in the series filter chain, so killing the low band silenced the mid/high bands too; fixed to floor only that band's own filter gain, verified by a test asserting a high-frequency tone survives a low-band kill
- Any bug fixes during the phase

### Changed
- Breaking changes or migrations

### Security
- Security-relevant changes

---

## [0.0.0] - 2026-09-22

### Added
- Project initialization
- Core architecture documentation
