# BongPlayer — Implementation Todo List

> **Source of truth for all agents.** Update this file when starting/completing phases.  
> **Changelog rule:** Every phase completion MUST include a corresponding entry in `CHANGELOG.md` (see AGENTS.md §19).

---

## Phase Checklist

| # | Phase | Status | Assigned | Notes |
|---|-------|--------|----------|-------|
| 1 | Project Scaffolding & Tauri v2 Shell | [x] Complete | Claude (Sonnet 5) | Completed 2026-09-22 |
| 2 | Modular Web Audio Graph | [ ] Pending | | |
| 2.5 | Audio Decoding & Waveform Pipeline (Risk #2) | [ ] Pending | | Waveform rendering undefined in original plan |
| 3 | Zustand State Slices | [ ] Pending | | |
| 3.5 | Automix Dead-Air Watchdog (Risk #4) | [ ] Pending | | Silence threshold, fallback action |
| 4 | Universal Tooltips, Context Menus & Drag-and-Drop | [ ] Pending | | |
| 5 | Resizable 3-Column Lower Bay | [ ] Pending | | |
| 6 | Decks, 60 FPS Platters & Center Mixer | [ ] Pending | | |
| 6.5 | MIDI Hot-Plug Support (Risk #5) | [ ] Pending | | `midimessage` + `statechange` handling |
| 6.5 | Keyboard Shortcuts & Accessibility (Risk #7) | [ ] Pending | | DJ-standard keymap, ARIA, focus management |
| 7 | Background Workers, Automix Engine & Web MIDI | [ ] Pending | | |
| 8 | Radio, Karaoke, Themes & Release Packaging | [ ] Pending | | |

---

## Phase Completion Protocol

When marking a phase **complete**:

1. Update the checkbox: `[x]`
2. Add `Assigned` agent identifier
3. Add completion date in `Notes`
4. **MANDATORY:** Append entry to `CHANGELOG.md` under `## [Unreleased]` (see format below)

---

## Changelog Entry Format

```markdown
## [Unreleased]

### Added
- **Phase N**: Brief description of what was delivered
  - Key implementation details
  - Files created/modified

### Fixed
- Any bug fixes during the phase

### Changed
- Breaking changes or migrations

### Security
- Security-relevant changes
```

---

## Current Sprint Focus

**Next up:** Phase 2 — Modular Web Audio Graph
