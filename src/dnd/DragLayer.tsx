// The label that follows the pointer during a drag.

import type { ReactNode } from "react";
import { useStore } from "../state/store";
import { dragStore } from "./drag";

export function DragLayer(): ReactNode {
  const drag = useStore(dragStore, (d) => d);
  if (!drag) return null;
  const where = drag.target ? "" : " — not here";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="drag-ghost"
      className="pointer-events-none fixed z-50 rounded border border-accent bg-surface-raised px-2 py-1 text-[12px] shadow-lg"
      style={{ left: drag.x + 14, top: drag.y + 10 }}
    >
      {drag.payload.label}
      <span className="text-muted">{where}</span>
    </div>
  );
}
