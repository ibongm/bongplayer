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

### Fixed
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
