// The dock: explorer | track table | Automix, with draggable dividers.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { backend } from "../ipc/backend";
import { AutomixPanel } from "./AutomixPanel";
import { Explorer } from "./Explorer";
import { TrackTable } from "./TrackTable";

const SETTING = "dock.widths";
const MIN = 160;

function Splitter({ label, onMove }: { label: string; onMove: (dx: number) => void }): ReactNode {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label} — drag, or focus and use ← / →`}
      className="w-1.5 shrink-0 cursor-col-resize bg-border/40 hover:bg-accent/60 focus-visible:bg-accent/60"
      onPointerDown={(e) => {
        e.preventDefault();
        let x = e.clientX;
        const move = (ev: PointerEvent): void => {
          onMove(ev.clientX - x);
          x = ev.clientX;
        };
        const up = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onMove(-20);
        else if (e.key === "ArrowRight") onMove(20);
        else return;
        e.preventDefault();
      }}
    />
  );
}

export function Dock(): ReactNode {
  const [widths, setWidths] = useState({ left: 260, right: 320 });
  const loaded = useRef(false);

  useEffect(() => {
    void backend()
      .settingGet(SETTING)
      .then((r) => {
        if (!r.ok || r.value === null) return;
        try {
          const v: unknown = JSON.parse(r.value);
          if (typeof v === "object" && v !== null && "left" in v && "right" in v) {
            const { left, right } = v;
            if (typeof left === "number" && typeof right === "number") setWidths({ left, right });
          }
        } catch {
          // Ignore a broken setting.
        }
      })
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  // Save the layout shortly after the last change.
  useEffect(() => {
    if (!loaded.current) return;
    const t = window.setTimeout(() => {
      void backend().settingSet(SETTING, JSON.stringify(widths));
    }, 400);
    return () => {
      window.clearTimeout(t);
    };
  }, [widths]);

  return (
    <div className="flex min-h-0 flex-1 border-t border-border">
      <div className="flex min-h-0 shrink-0 flex-col bg-surface/60" style={{ width: widths.left }}>
        <Explorer />
      </div>
      <Splitter
        label="Resize explorer"
        onMove={(dx) => {
          setWidths((w) => ({ ...w, left: Math.max(MIN, w.left + dx) }));
        }}
      />
      <TrackTable />
      <Splitter
        label="Resize Automix"
        onMove={(dx) => {
          setWidths((w) => ({ ...w, right: Math.max(MIN, w.right - dx) }));
        }}
      />
      <div className="flex min-h-0 shrink-0 flex-col bg-surface/60" style={{ width: widths.right }}>
        <AutomixPanel />
      </div>
    </div>
  );
}
