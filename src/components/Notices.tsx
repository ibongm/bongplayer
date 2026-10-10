// Error and info messages (errors stay until closed; info fades after 5 s).

import type { ReactNode } from "react";
import { dismiss, notices } from "../state/app";
import { useStore } from "../state/store";

export function Notices(): ReactNode {
  const list = useStore(notices, (n) => n);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-40 flex w-[380px] flex-col gap-2">
      {list.map((n) => (
        <div
          key={n.id}
          role={n.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] shadow-lg ${
            n.kind === "error" ? "border-danger bg-danger/15" : "border-border bg-surface-raised"
          }`}
        >
          <span className="flex-1 break-words">{n.text}</span>
          <button
            type="button"
            aria-label="Close message"
            title="Close"
            className="text-muted hover:text-text"
            onClick={() => {
              dismiss(n.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
