// LOCK and DUCK buttons for the top bar (and the DAY view).

import { useRef, useState, type ReactNode } from "react";
import { backend } from "../ipc/backend";
import { notify, status } from "../state/app";
import { useStore } from "../state/store";
import { askText } from "./Dialog";

export const HOLD_MS = 2000;

export async function unlockWithPin(): Promise<void> {
  const pin = await askText("Unlock", "PIN (leave empty if no PIN is set)", "", "Unlock");
  const r = await backend().lockRelease(pin, false);
  if (!r.ok) notify("error", `Unlock: ${r.error}`);
}

export function LockButton({ big = false }: { big?: boolean }): ReactNode {
  const locked = useStore(status, (s) => s?.locked ?? false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const [holding, setHolding] = useState(false);

  const stopHold = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  return (
    <button
      type="button"
      aria-pressed={locked}
      aria-label={locked ? "Locked — unlock" : "Lock"}
      title={
        locked
          ? "Locked: click to enter the PIN, or hold for 2 seconds to unlock (if allowed) — Ctrl+K"
          : "LOCK: block play / skip / load / crossfader / queue edits so nothing changes by accident (Ctrl+K)"
      }
      className={`rounded font-bold tracking-wide ${big ? "px-5 py-3 text-[16px]" : "px-2.5 py-0.5 text-[11px]"} ${
        locked ? "bg-danger text-danger-text" : "bg-surface-raised text-muted hover:text-text"
      } ${holding ? "ring-2 ring-accent" : ""}`}
      onPointerDown={(e) => {
        if (!locked || e.button !== 0) return;
        held.current = false;
        setHolding(true);
        timer.current = window.setTimeout(() => {
          held.current = true;
          setHolding(false);
          void backend()
            .lockRelease(null, true)
            .then((r) => {
              if (!r.ok) notify("error", `Unlock: ${r.error}`);
            });
        }, HOLD_MS);
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        if (locked) void unlockWithPin();
        else
          void backend()
            .lockEngage()
            .then((r) => {
              if (!r.ok) notify("error", `Lock: ${r.error}`);
            });
      }}
    >
      {locked ? "🔒 LOCKED" : "LOCK"}
    </button>
  );
}

export function toggleDuck(): void {
  const on = status.get()?.duckOn ?? false;
  void backend()
    .duck(!on)
    .then((r) => {
      if (!r.ok) notify("error", `DUCK: ${r.error}`);
    });
}

export function DuckButton({ big = false }: { big?: boolean }): ReactNode {
  const on = useStore(status, (s) => s?.duckOn ?? false);
  const db = useStore(status, (s) => Math.round(s?.duckDb ?? 0));
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="DUCK"
      title="DUCK: lower the music for an announcement; click again to bring it back (D)"
      className={`rounded font-bold tracking-wide ${big ? "px-5 py-3 text-[16px]" : "px-2.5 py-0.5 text-[11px]"} ${
        on ? "bg-accent text-bg" : "bg-surface-raised text-muted hover:text-text"
      }`}
      onClick={toggleDuck}
    >
      DUCK{on && db < 0 ? ` ${db} dB` : ""}
    </button>
  );
}
