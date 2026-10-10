import { use } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppInfo, IpcResult } from "./ipc/types";
import { errorMessage } from "./ipc/backend";

type WindowAction = "minimize" | "toggleMaximize" | "close";

interface TitlebarProps {
  appInfo: Promise<IpcResult<AppInfo>>;
  onError: (message: string) => void;
}

const controls: { action: WindowAction; label: string; tooltip: string; glyph: string }[] = [
  { action: "minimize", label: "Minimise", tooltip: "Minimise (Win+↓)", glyph: "—" },
  { action: "toggleMaximize", label: "Maximise or restore", tooltip: "Maximise / restore (Win+↑)", glyph: "▢" },
  { action: "close", label: "Close", tooltip: "Close BongPlayer (Alt+F4)", glyph: "✕" },
];

export function Titlebar({ appInfo, onError }: TitlebarProps) {
  const info = use(appInfo);
  const inDesktopApp = isTauri();

  async function run(action: WindowAction) {
    try {
      const win = getCurrentWebviewWindow();
      await win[action]();
    } catch (err) {
      onError(`Window action failed: ${errorMessage(err)}`);
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center border-b border-border bg-surface pl-3"
    >
      <img src="/logo.svg" alt="" className="pointer-events-none h-5 w-5" />
      <span data-tauri-drag-region className="ml-2 text-[13px] font-semibold tracking-wide">
        BongPlayer
      </span>
      <span data-tauri-drag-region className="ml-2 text-[11px] text-muted" data-testid="app-version">
        {info.ok ? `v${info.value.version}` : "version unknown"}
      </span>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex h-full">
        {controls.map((c) => (
          <button
            key={c.action}
            type="button"
            aria-label={c.label}
            title={inDesktopApp ? c.tooltip : `${c.tooltip} — only in the desktop app`}
            disabled={!inDesktopApp}
            onClick={() => void run(c.action)}
            className={`h-full w-11 text-[13px] text-muted hover:text-text disabled:opacity-40 ${
              c.action === "close"
                ? "hover:bg-danger hover:text-danger-text"
                : "hover:bg-surface-raised"
            }`}
          >
            {c.glyph}
          </button>
        ))}
      </div>
    </header>
  );
}
