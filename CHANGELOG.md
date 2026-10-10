# Changelog

All notable changes to BongPlayer are recorded here, newest first, with the date and time
of each change (PC local time). Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Categories: **Added**, **Changed**, **Fixed**, **Removed**, **Security**.

## [Unreleased]

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
- **Commit:** pending

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
