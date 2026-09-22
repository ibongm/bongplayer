# AGENTS.md — Audio Architecture & Engineering Guidelines

This document governs the engineering standards, architecture, and coding conventions for AI agents operating on this repository. Follow these directives strictly.

---

## 1. Project Overview & Core Stack

This project is a high-performance Windows desktop application combining a native Rust core with a modern reactive frontend and low-latency audio processing.

- **Target Platform:** Windows 10 / Windows 11 (64-bit architecture) running on Microsoft Edge WebView2.
- **Backend Shell:** Tauri v2 (`@tauri-apps/cli` v2.x, Rust 2021 edition).
- **Frontend Framework:** React 19, TypeScript 5.x, Vite.
- **Audio Processing:** Web Audio API (frontend graph engine, custom `AudioWorkletNode` processors) with optional native DSP hooks via Tauri Rust backend.
- **Styling & UI:** Tailwind CSS, Lucide React (or equivalent lightweight SVG iconography).
- **Package Manager:** `npm` (or `pnpm` if lockfile is present).

---

## 2. Essential Commands (Windows PowerShell)

All AI agents executing or recommending terminal commands must assume **PowerShell** on Windows. Always use double quotes around compound arguments and avoid Unix-only commands (`rm -rf`, `export`, etc.).

### Development & Execution
```powershell
# Start Vite dev server and launch Tauri desktop window
npm run tauri dev

# Run frontend independently in browser (mocking native Tauri calls)
npm run dev

# Compile full production release installer (.msi / .exe)
npm run tauri build
```

### Quality Control & Verification
```powershell
# Typecheck TypeScript (zero errors allowed)
npm run build -- --noEmit

# Lint and formatting verification
npm run lint
npm run format

# Run Rust tests in Tauri backend
cargo test --manifest-path src-tauri/Cargo.toml

# Clean build artifacts
Remove-Item -Recurse -Force dist, src-tauri/target
```

---

## 3. Repository Architecture & File Boundaries

Maintain strict separation of concerns across native, graphical, and audio domains.

```text
├── .github/                      # CI/CD workflows (Windows build matrix)
├── src/                          # Frontend Application (React 19 + TypeScript)
│   ├── audio/                    # Core Web Audio pipeline
│   │   ├── worklets/             # AudioWorkletProcessor scripts (.ts / .js)
│   │   ├── nodes/                # Custom node definitions, chains, and DSP logic
│   │   ├── context.ts            # Centralized AudioContext singleton and lifecycle
│   │   └── index.ts              # Unified audio export entry
│   ├── components/               # UI components (pure presentation & control)
│   │   ├── audio/                # Visualizers, oscilloscopes, parameter dials
│   │   └── layout/                # Window framing, titlebar, container shells
│   ├── hooks/                    # React hooks (useAudioNode, useAudioParam, etc.)
│   ├── services/                 # Tauri IPC abstractions and platform adapters
│   │   ├── ipc.ts                # Strongly typed invoke wrappers
│   │   └── dialog.ts             # File picker and system interactions
│   ├── types/                    # Shared ambient and domain TypeScript interfaces
│   ├── App.tsx                   # Top-level UI orchestration
│   └── main.tsx                  # React root mount and initial setup
├── src-tauri/                    # Native Backend (Rust)
│   ├── capabilities/             # Tauri v2 security policies (permissions)
│   │   └── default.json          # Core permission scopes (fs, dialog, core)
│   ├── src/
│   │   ├── commands/             # Native command handlers exposed via IPC
│   │   ├── audio_native/         # Optional native audio/MIDI processing (CPAL/Hound)
│   │   ├── lib.rs                # App setup, builder registration, and plugins
│   │   └── main.rs               # Binary entry point
│   ├── Cargo.toml                # Rust dependencies and profile configuration
│   └── tauri.conf.json           # Tauri v2 configuration (windows, bundle, security)
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 4. React 19 & TypeScript Directives

### React 19 Conventions
1. **No `forwardRef`:** React 19 passes `ref` directly as a standard component prop. Never wrap functional components in `React.forwardRef()`.
2. **First-Class Async & Actions:**
   - Use `useActionState` and `useOptimistic` for state transitions driven by asynchronous user actions.
   - Use the `use()` hook to read Promises or Context conditionally within components.
3. **No `defaultProps`:** Use ES6 default parameter values for functional components.
4. **Clean Effects:** Never initiate synchronous audio node connections inside uncontrolled re-renders. All graph mutations must occur inside lifecycle-managed hooks or dedicated service methods.

### TypeScript Conventions
1. **Strict Type Safety:** Enable `"strict": true`, `"noImplicitAny": true`, and `"strictNullChecks": true`.
2. **Never Use `any`:** Use `unknown` with type guards or create distinct branded types/interfaces.
3. **Audio Node Typing:** Explicitly type Web Audio nodes (`GainNode`, `BiquadFilterNode`, `AudioWorkletNode`) instead of relying on loose inheritance.

---

## 5. Web Audio API Guidelines

Audio instability, clicks, memory leaks, and autoplay blocking are primary failure vectors. Agents must adhere to these rules:

### Context & Autoplay Lifecycle
- **Singleton Pattern:** Never construct multiple `AudioContext` instances. Maintain a single managed instance in `src/audio/context.ts`.
- **User Gesture Resumption:** In Windows WebView2, `AudioContext` initializes in the `"suspended"` state. Wrap all context initialization or resumption in a user interaction event (click, keydown, or explicitly handled UI button):
  ```typescript
  export async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }
  ```
- **Sample Rate Uniformity:** Default to the hardware native sample rate (`contextOptions: { latencyHint: "interactive" }`). Do not force unsupported sample rates unless resamplers are configured.

### Graph & Memory Management
- **Explicit Disconnects:** Every node created dynamically during component lifecycles must be disconnected (`node.disconnect()`) in cleanup functions (`useEffect` teardowns). Failing to disconnect nodes leaks memory and accumulates processing overhead.
- **AudioParam Automation:** Use ramp methods (`linearRampToValueAtTime`, `exponentialRampToValueAtTime`, or `setTargetAtTime`) rather than direct assignment (`param.value = x`) to eliminate audio clicks, pops, and zipper noise.

### AudioWorklet Architecture in Tauri/Vite
- **Worklet Loading:** Use Vite's native URL resolution for audio worklet scripts:
  ```typescript
  const workletUrl = new URL('./worklets/dsp-processor.ts', import.meta.url).href;
  await audioCtx.audioWorklet.addModule(workletUrl);
  ```
- **Thread Safety:** AudioWorklets execute on a dedicated real-time audio thread. Never attempt to read or mutate DOM, window objects, or React states inside an `AudioWorkletProcessor`.

---

## 6. Tauri v2 & Windows Platform Rules

### Tauri v2 API Standards
- **Import Paths:**
  - Standard IPC: `import { invoke } from "@tauri-apps/api/core";` (Do **not** use the deprecated v1 `@tauri-apps/api/tauri`).
  - Window Management: Use `@tauri-apps/api/webviewWindow`.
  - Plugins: Use official v2 namespaces: `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`, etc.
- **Permissions & Capabilities:** Tauri v2 enforces strict capability policies. If invoking a new plugin command or filesystem path, explicitly declare the permission in `src-tauri/capabilities/default.json`.

### Windows-Specific Platform Considerations
- **File System Separators:** Windows uses backslashes (`\`) for local paths. Never perform manual string manipulation on paths; use `@tauri-apps/api/path` or Rust's `std::path::PathBuf`.
- **Custom Titlebar & Draggable Areas:** If custom window styling is active (`decorations: false`), annotate drag zones with the `data-tauri-drag-region` attribute. Ensure interactive controls (buttons, sliders, inputs) nested within drag areas explicitly cancel or isolate drag events.
- **WebView2 Media Codecs:** WebView2 relies on the underlying Windows Media Foundation. Standard WAV, MP3, and AAC containers are supported natively. For exotic audio formats (e.g., FLAC, OGG/Vorbis), parse/decode the binary in Rust and pass raw PCM buffers over IPC or decode via WebAssembly.

---

## 7. AI Agent Operational Directives

All AI agents operating on this repository must adhere to the following standards:

### Architecture & Safety
- Focus on comprehensive architecture and safety.
- Provide fully typed interfaces and ensure complete implementation without placeholders.
- When generating complex Web Audio node graphs, always implement the corresponding teardown logic.

### Structural Accuracy & Standards Compliance
- Focus on high-speed structural accuracy and edge cases.
- Validate that all imports adhere strictly to Tauri v2 and React 19 standards.
- Ensure audio math (dB conversions, frequency warping, ramp curves) uses precise numerical formulas.

### Production-Hardened Implementation
- Deliver direct, production-hardened implementations.
- Avoid introducing unnecessary third-party npm dependencies when native Web Audio or browser APIs suffice.
- Ensure PowerShell command scripts and Rust build configurations are directly copy-pasteable.

---

## 8. General Output Rules for All Agents

1. **No Code Ellipses:** Never write `// ... rest of code`, `/* TODO */`, or omit existing logic unless explicitly asked for a targeted diff. Supply the complete file or the exact modification context.
2. **Defensive IPC Calls:** Wrap all `invoke()` calls in `try/catch` blocks and transform native Rust errors into structured frontend error states.
3. **Verify Deprecations:**
   - No React `componentWillMount`, `findDOMNode`, or `forwardRef`.
   - No Tauri v1 API references.
   - No deprecated Web Audio APIs (`createScriptProcessor` is forbidden; use `AudioWorklet`).

---

## 9. Changelog & Todo Discipline

### Changelog Requirements
- **Every phase completion MUST append an entry to `CHANGELOG.md`** under `## [Unreleased]`
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format with categories: `Added`, `Fixed`, `Changed`, `Security`
- Reference the phase number and key deliverables
- Entries are promoted to versioned sections during release

### Todo List Maintenance
- **Source of truth:** `TODO.md` in repository root
- Update checkboxes (`[ ]` → `[x]`) immediately upon phase completion
- Record `Assigned` agent and completion date in `Notes` column
- Never delete or reorder phases without architectural review

### Release Protocol
- On version bump: move `## [Unreleased]` entries to `## [X.Y.Z] - YYYY-MM-DD`
- Generate `CHANGELOG.md` diff for release notes
- Tag commit with `vX.Y.Z` and push tags

### Git Discipline
- **Every phase completion MUST commit and push all changes** to the remote repository
- Commit message format: `phase(N): brief description of deliverables`
- Include `TODO.md` and `CHANGELOG.md` updates in the same commit
- Push immediately after commit: `git push origin main`
- Never leave uncommitted phase work locally
