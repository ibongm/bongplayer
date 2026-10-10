import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import { ContextMenuHost } from "./components/ContextMenu";
import { DialogHost } from "./components/Dialog";
import { Dock } from "./components/Dock";
import { DeckStrip } from "./components/deck/DeckStrip";
import { Notices } from "./components/Notices";
import { DragLayer } from "./dnd/DragLayer";
import { backend } from "./ipc/backend";
import type { AppInfo, IpcResult } from "./ipc/types";
import { openSource, run } from "./state/app";
import { Titlebar } from "./Titlebar";

interface AppProps {
  appInfo: Promise<IpcResult<AppInfo>>;
}

function StartupError({ appInfo }: AppProps): ReactNode {
  const info = use(appInfo);
  if (info.ok) return null;
  return <ErrorBanner message={`Could not read app info from Rust: ${info.error}`} />;
}

function ErrorBanner({ message }: { message: string }): ReactNode {
  return (
    <div role="alert" className="bg-danger px-3 py-1.5 text-[12px] text-danger-text">
      {message}
    </div>
  );
}

/** Keyboard shortcuts that work anywhere in the window. */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === "f" || e.key === "F")) {
        const search = document.querySelector<HTMLInputElement>('[data-shortcut="ctrl+f"]');
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      } else if (ctrl && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void openSource({ kind: "library" });
      } else if (e.key === "F1" || e.key === "F5") {
        e.preventDefault();
        const deck = e.key === "F1" ? "A" : "B";
        void backend()
          .engineCommand({ type: "togglePlay", deck })
          .then((r) => run(r, `Deck ${deck}`));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

export function App({ appInfo }: AppProps): ReactNode {
  const [error, setError] = useState<string | null>(null);
  useGlobalShortcuts();

  return (
    <div className="flex h-full w-full flex-col">
      <Suspense fallback={<div className="h-9 shrink-0 border-b border-border bg-surface" />}>
        <Titlebar appInfo={appInfo} onError={setError} />
        <StartupError appInfo={appInfo} />
      </Suspense>
      {error !== null && <ErrorBanner message={error} />}
      <main className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex shrink-0 gap-2 p-2">
          <DeckStrip deck="A" />
          <DeckStrip deck="B" />
        </div>
        <Dock />
      </main>
      <ContextMenuHost />
      <DialogHost />
      <DragLayer />
      <Notices />
    </div>
  );
}
