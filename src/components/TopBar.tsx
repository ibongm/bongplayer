// Top bar contents (inside the custom titlebar): venue clock, view tabs, shortcut list,
// settings, engine status pill.

import { useEffect, useState, type ReactNode } from "react";
import { status } from "../state/app";
import { useStore } from "../state/store";
import { settingsOpen, view, type View } from "../state/ui";
import { openMenu } from "./ContextMenu";
import { DuckButton, LockButton } from "./LockDuck";
import { radioOpen } from "./RadioStrip";

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "standard", label: "STANDARD", key: "Ctrl+1" },
  { id: "decks", label: "DECKS", key: "Ctrl+2" },
  { id: "library", label: "LIBRARY", key: "Ctrl+3" },
  { id: "day", label: "DAY", key: "Ctrl+4" },
];

export const SHORTCUTS: [string, string][] = [
  ["F1 / F5", "Play / pause deck A / B"],
  ["F2 / F6", "CUE deck A / B (hold)"],
  ["F3 / F7", "CUP deck A / B"],
  ["F4 / F8", "SYNC deck A / B"],
  ["1 … 8", "Hot cue 1–8 on deck A"],
  ["Shift+1 … 8", "Hot cue 1–8 on deck B"],
  ["Ctrl+1 / 2 / 3 / 4", "Standard / Decks / Library / Day view"],
  ["D", "DUCK on / off"],
  ["Ctrl+K", "LOCK (when locked: unlock with PIN)"],
  ["Ctrl+F", "Search tracks"],
  ["Ctrl+L", "Music Library"],
  ["Enter / Shift+Enter", "Load selected track to deck A / B"],
  ["Q", "Add selected tracks to Automix"],
  ["Ctrl+,", "Settings"],
  ["Ctrl+R", "Radio strip"],
  ["Ctrl+I", "Automix / Info tab"],
];

function Clock(): ReactNode {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return (
    <span data-tauri-drag-region className="whitespace-nowrap text-[15px] font-semibold tabular-nums" title="Time">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function RadioToggle(): ReactNode {
  const open = useStore(radioOpen, (o) => o);
  return (
    <button
      type="button"
      aria-pressed={open}
      title="Show / hide the Radio strip (Ctrl+R)"
      className={`rounded px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${open ? "bg-accent/30 text-text" : "bg-surface-raised text-muted hover:text-text"}`}
      onClick={() => {
        radioOpen.set(!open);
      }}
    >
      RADIO
    </button>
  );
}

function StatusPill(): ReactNode {
  const running = useStore(status, (s) => s?.output.running ?? false);
  const device = useStore(status, (s) => s?.output.device ?? null);
  const problem = useStore(status, (s) => s?.output.problem ?? null);
  const rate = useStore(status, (s) => s?.sampleRate ?? 0);
  const text = running ? `${Math.round(rate / 100) / 10} kHz · ${device ?? "output"}` : "NO OUTPUT";
  return (
    <button
      type="button"
      title={`${running ? `Playing on ${device ?? "the default device"} at ${rate} Hz` : "No sound output"}${problem ? ` — last problem: ${problem}` : ""} (click for audio settings)`}
      aria-label={`Audio engine: ${text}`}
      className={`max-w-56 min-w-24 shrink-0 truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        running ? "bg-accent/20 text-text" : "bg-danger text-danger-text"
      }`}
      onClick={() => {
        settingsOpen.set(true);
      }}
    >
      ● {text}
    </button>
  );
}

export function TopBar(): ReactNode {
  const current = useStore(view, (v) => v);
  return (
    <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center gap-3 px-3">
      <Clock />
      <div role="tablist" aria-label="Views" className="flex gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={current === v.id}
            title={`${v.label} view (${v.key})`}
            className={`rounded px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${
              current === v.id ? "bg-accent text-bg" : "text-muted hover:bg-surface-raised hover:text-text"
            }`}
            onClick={() => {
              view.set(v.id);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div data-tauri-drag-region className="flex-1" />
      <button
        type="button"
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        className="rounded px-2 py-0.5 text-[13px] text-muted hover:bg-surface-raised hover:text-text"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(
            r.left,
            r.bottom + 4,
            SHORTCUTS.map(([key, what], i) => ({ id: `k${i}`, label: what, shortcut: key })),
          );
        }}
      >
        ⌨
      </button>
      <RadioToggle />
      <DuckButton />
      <LockButton />
      <StatusPill />
      <button
        type="button"
        title="Settings (Ctrl+,)"
        aria-label="Settings"
        className="rounded px-2 py-0.5 text-[16px] text-muted hover:bg-surface-raised hover:text-text"
        onClick={() => {
          settingsOpen.set(true);
        }}
      >
        ⚙
      </button>
    </div>
  );
}
