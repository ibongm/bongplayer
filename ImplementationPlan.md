# BongPlayer — Master Implementation Plan & System Architecture

Autonomous implementation blueprint.
Architecture: Tauri v2 + React 19 + TypeScript + Web Audio API (Windows 10/11 x64 target).

---

## 1. UI Layout Blueprint (VirtualDJ 3-Column Dock)

┌────────────────────────────────────────────────────────────────────────────┐
│                        TOP: DUAL BEAT WAVEFORMS                            │
├───────────────────────┬────────────────────────────┬───────────────────────┤
│        DECK A         │        CENTER MIXER        │        DECK B         │
│  (Platter, Pitch,     │ (3-Band EQ, Kills, Filter, │  (Platter, Pitch,     │
│   Hot Cues, Sampler)  │  VU, Faders, Crossfader)   │   Hot Cues, Sampler)  │
├───────────────────────┴────────────────────────────┴───────────────────────┤
│ ◄═════════════════════ RESIZABLE 3-COLUMN DOCK ══════════════════════════► │
│    FOLDER BROWSER     │ ║   FOLDER CONTENTS TABLE  ║ │    AUTOMIX DOCK     │
│  (Drives & OS Folders)│ ║  (Title, Artist, BPM...) ║ │ (Queue, Transition) │
│     [Col 1: ~20%]     │ ║       [Col 2: ~55%]      ║ │    [Col 3: ~25%]    │
└───────────────────────┴─╨──────────────────────────┴─┴─────────────────────┘

- **Top**: Dual continuous beat-matching waveforms centered on an illuminated playhead.
- **Middle**: Deck A, Center 2-Channel DJM Mixer (Equal-power crossfader, EQs, kills, bipolar filter), Deck B.
- **Bottom (3-Column Dock)**:
  - Column 1 (Left, ~20%): Direct OS folder tree explorer (`C:\`, `D:\`, removable USB, OS music directory).
  - Column 2 (Center, ~55%): Track table showing audio files in the selected folder with instant search filter.
  - Column 3 (Right, ~25%): Automix cockpit & staged play queue with runtime stats and transition controls. Includes dock switcher tabs (`Automix` | `Sampler` | `Karaoke`).

---

## 2. Universal Interaction Protocols

### 2.1 Universal Tooltips
- Wrap every button, knob, slider, and status pill with `<Tooltip text="..." shortcut="...">`.
- 150ms entry delay, boundary-aware positioning, venue glassmorphic styling.

### 2.2 Global Context Menus
- Intercept default browser context menus globally.
- Menu actions:
  - **Decks**: Clear/Eject Track, Reset Pitch (0%), Clear Hot Cues, Analyze BPM/Key.
  - **Track Table Rows**: Load to Deck A, Load to Deck B, Add to Automix, Show in File Explorer.
  - **Automix Rows**: Remove Track, Move to Top, Move to Bottom, Clear Entire Queue.
  - **Knobs / Sliders**: Reset to Center / Default (0 dB / 12:00).
  - **Sampler Slots**: Clear Slot, Set Choke Group (0–4), Adjust Gain.

### 2.3 Universal Drag-and-Drop Matrix
- **Internal**: Drag track rows from Track Table into Deck A, Deck B, or Automix Queue.
- **External (Native OS)**: Tauri `onDragDropEvent` listener routing files/folders from Windows Explorer into:
  - Decks: Instant load & analyze.
  - Automix: Enqueue tracks.
  - Folder Tree: Auto-expand and navigate directly to dropped folder.

---

## 3. Phase-by-Phase Implementation

### Phase 1: Project Scaffolding & Tauri v2 Shell
- [ ] Initialize Tauri v2 + React 19 + TypeScript + Vite (`com.bongplayer.app`).
- [ ] Configure Tailwind CSS v3 with PostCSS and CSS variables for skin support.
- [ ] Configure `src-tauri/capabilities/default.json` with permissions (`fs:default`, `fs:allow-read-dir`, `fs:allow-read-file`, `fs:allow-stat`, `dialog:default`).
- [ ] Configure `assetProtocol.scope` in `src-tauri/tauri.conf.json` for `C:/**`, `D:/**`, `E:/**`.
- [ ] Verify `npx tsc --noEmit` and `npm run tauri dev` boot with clean window.

### Phase 2: Modular Web Audio Graph
- [ ] `src/audio/context.ts`: Singleton `AudioContext` with silent auto-resume on first user gesture.
- [ ] `src/audio/nodes/musicBus.ts`: Deck summing bus with −9 dB sample-ducking gain stage.
- [ ] `src/audio/nodes/samplerBus.ts`: Dedicated 8-voice sample bus connected pre-limiter.
- [ ] `src/audio/nodes/masterLimiter.ts`: `DynamicsCompressorNode` (-0.5 dB, 20:1) with emergency ducking (-80% over 200ms).
- [ ] `src/audio/nodes/threeBandEQ.ts`: Low-shelf (250 Hz), Peaking (1 kHz), High-shelf (8 kHz) (-24 dB to +6 dB) with kill switches.
- [ ] `src/audio/nodes/bipolarFilter.ts`: Normalized single knob LPF/HPF sweep.
- [ ] `src/audio/nodes/equalPower.ts`: Constant-power crossfade curve ($gain_A = \cos(p \cdot \pi / 2)$, $gain_B = \cos((1 - p) \cdot \pi / 2)$).
- [ ] `src/audio/nodes/pflBus.ts`: Headphone cue routing (dual soundcards via `setSinkId` or split-cable Master L / Cue R).

### Phase 3: Zustand State Slices
- [ ] `src/store/useDeckAStore.ts` & `src/store/useDeckBStore.ts`: Track metadata, playback state, current time, pitch rate, hot cues.
- [ ] `src/store/useMixerStore.ts`: Channel gains, EQ values, kills, filter, volume faders, crossfader, PFL cues, master gain.
- [ ] `src/store/useLibraryStore.ts`: Selected folder path, scanned audio files, search query, column sorting.
- [ ] `src/store/useAutomixStore.ts`: Queue array, ping-pong state machine status, trigger thresholds, transition style.
- [ ] `src/store/useSamplerStore.ts`: 8 slots (file path, label, gain trim, choke group 0–4).
- [ ] `src/store/useUIStore.ts`: Shift Lock state, active theme, panel split ratios, active context menu.

### Phase 4: Universal Tooltips, Context Menus & Drag-and-Drop
- [ ] `src/components/common/Tooltip.tsx`: Viewport-aware glassmorphic tooltip with 150ms delay.
- [ ] `src/components/common/ContextMenu.tsx`: Global right-click handler with boundary-aware positioning.
- [ ] `src/services/dragAndDrop.ts`: Internal HTML5 drag coordinator + Tauri native OS file drop listener.

### Phase 5: Resizable 3-Column Lower Bay
- [ ] `src/hooks/useResizablePanels.ts`: Splitter hook enforcing Left (min 160px) and Right (min 220px) bounds, persisted in `localStorage`.
- [ ] `src/components/common/SplitterHandle.tsx`: Draggable divider with double-click reset to 20% / 55% / 25%.
- [ ] `src/components/library/FolderTree.tsx`: Direct OS tree explorer for Windows drive letters and music folders.
- [ ] `src/components/library/TrackTable.tsx`: Virtualized track table with search filtering and drag triggers.
- [ ] `src/components/library/AutomixPanel.tsx`: Staged queue, total time, start/stop toggle, transition picker, and clear action.

### Phase 6: Decks, 60 FPS Platters & Center Mixer
- [ ] `src/components/deck/JogWheel.tsx`: Direct DOM `requestAnimationFrame` continuous 33⅓ RPM needle rotation and touch-scrubbing.
- [ ] `src/components/deck/PitchSection.tsx`: Vertical pitch slider with center detent, pitch bend, and Key Lock toggle.
- [ ] `src/components/deck/CuePadMatrix.tsx`: 8-pad RGB matrix switching between Hot Cues (A–H) and 8-Slot Sampler.
- [ ] `src/components/mixer/ChannelStrip.tsx`: Trim, 3-band EQs with kill buttons, bipolar filter, and volume faders.
- [ ] `src/components/mixer/CenterMixer.tsx`: Stereo VU meters (`AnalyserNode`), crossfader, and master transport bar (Play, Pause, Stop).
- [ ] `src/components/waveforms/ScrollingWaveforms.tsx`: Dual full-width beat waveforms with centered playhead and hot-cue flags.

### Phase 7: Background Workers, Automix Engine & Web MIDI
- [ ] `src/workers/audioAnalysis.worker.ts`: Autocorrelation BPM detection, Camelot key detection, and peak calculation.
- [ ] `src/audio/automixController.ts`: Ping-pong state machine with Smooth, Bass Swap, Cut, and Echo-Out transitions + dead-air watchdog.
- [ ] `src/services/midiController.ts`: Pioneer DDJ-400 Web MIDI profile (faders, EQs, jog wheels, buttons, bidirectional LEDs).

### Phase 8: Radio, Karaoke, Themes & Release Packaging
- [ ] `src-tauri/src/radio.rs`: Local Rust TCP proxy (`127.0.0.1:17420`) for Icecast/Shoutcast streams with ICY title extraction.
- [ ] `src/components/karaoke/KaraokeStage.tsx`: Full-bleed synced lyrics stage with click-to-seek, resolving via cache, ID3, or LRCLIB.
- [ ] `src/theme/themes.ts`: 4 skins (*Midnight Slate*, *Pioneer Stealth*, *Technics Silver*, *Day Shift*) via CSS variables + canvas redraws.
- [ ] Verification: `npx tsc --noEmit` clean, tests pass, and Windows installer built via `npm run tauri build -- --bundles nsis,msi`.

---

