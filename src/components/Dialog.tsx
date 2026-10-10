// In-app modal dialogs (text prompt, confirmation). Browser alert/confirm/prompt would block
// the whole window, so they are never used.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createStore, useStore } from "../state/store";

type DialogRequest = { id: number } & (
  | {
      kind: "prompt";
      title: string;
      label: string;
      initial: string;
      okLabel: string;
      resolve: (v: string | null) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      okLabel: string;
      danger: boolean;
      resolve: (v: boolean) => void;
    }
);

const dialogStore = createStore<DialogRequest | null>(null);
let nextId = 1;

export function askText(title: string, label: string, initial = "", okLabel = "OK"): Promise<string | null> {
  return new Promise((resolve) => {
    dialogStore.set({ id: nextId++, kind: "prompt", title, label, initial, okLabel, resolve });
  });
}

export function confirmAction(
  title: string,
  message: string,
  okLabel: string,
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    dialogStore.set({ id: nextId++, kind: "confirm", title, message, okLabel, danger, resolve });
  });
}

export function DialogHost(): ReactNode {
  const req = useStore(dialogStore, (d) => d);
  if (!req) return null;
  // A fresh body per request, so its text starts from the request's initial value.
  return <DialogBody key={req.id} req={req} />;
}

function DialogBody({ req }: { req: DialogRequest }): ReactNode {
  const [text, setText] = useState(req.kind === "prompt" ? req.initial : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (req.kind === "prompt") inputRef.current?.select();
    else okRef.current?.focus();
  }, [req]);

  const close = (ok: boolean): void => {
    dialogStore.set(null);
    if (req.kind === "prompt") req.resolve(ok && text.trim() !== "" ? text.trim() : null);
    else req.resolve(ok);
  };
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close(false);
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        className="w-[420px] rounded-lg border border-border bg-surface p-4 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          close(true);
        }}
      >
        <h2 className="mb-3 text-[15px] font-semibold">{req.title}</h2>
        {req.kind === "prompt" ? (
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {req.label}
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              className="rounded border border-border bg-bg px-2 py-1.5 text-[13px] text-text"
            />
          </label>
        ) : (
          <p className="text-[13px]">{req.message}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-[13px] hover:bg-surface-raised"
            title="Cancel (Esc)"
            onClick={() => {
              close(false);
            }}
          >
            Cancel
          </button>
          <button
            ref={okRef}
            type="submit"
            title={`${req.okLabel} (Enter)`}
            className={`rounded px-3 py-1.5 text-[13px] font-semibold ${
              req.kind === "confirm" && req.danger
                ? "bg-danger text-danger-text"
                : "bg-accent text-bg"
            }`}
          >
            {req.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
