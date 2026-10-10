// Sampler strip (collapsible, under the top bar): 8 pads. Drop a sound on a pad (from Windows
// Explorer or the track table), or right-click → Choose file…. Click a pad (or Alt+1…8) to
// play it from the start. Each pad has a volume knob and an optional choke group.

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PadInfo } from "../ipc/types";
import { notify, status } from "../state/app";
import { clearPad, configurePad, loadPad, pads, refreshPads, samplerOpen, stopPads, triggerPad } from "../state/sampler";
import { useStore } from "../state/store";
import { openMenu, type MenuItem } from "./ContextMenu";
import { Knob } from "./controls/Knob";

const VOLUMES = [6, 3, 0, -3, -6, -12, -20];

const dbText = (v: number): string => (v <= -60 ? "off" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`);

export async function choosePadFile(pad: number): Promise<void> {
  if (!isTauri()) {
    notify("error", "Choosing a file needs the desktop app — drop a file on the pad instead");
    return;
  }
  const picked = await openFileDialog({
    multiple: false,
    title: `Sound for pad ${pad + 1}`,
    filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "m4a", "aac", "ogg"] }],
  });
  if (typeof picked === "string") await loadPad(pad, picked);
}

export function padMenu(p: PadInfo, playing: boolean): MenuItem[] {
  const n = p.index + 1;
  const loaded = p.seconds !== null;
  return [
    { id: "play", label: `Play pad ${n}`, shortcut: `Alt+${n}`, disabled: !loaded, onSelect: () => void triggerPad(p.index) },
    { id: "stop", label: `Stop pad ${n}`, disabled: !playing, onSelect: () => void stopPads(p.index) },
    { id: "choose", label: "Choose file…", separator: true, onSelect: () => void choosePadFile(p.index) },
    {
      id: "volume",
      label: "Volume",
      submenu: VOLUMES.map((db) => ({
        id: `vol${db}`,
        label: `${Math.abs(p.gainDb - db) < 0.05 ? "✓" : "  "} ${dbText(db)}`,
        onSelect: () => void configurePad(p.index, db, p.choke),
      })),
    },
    {
      id: "choke",
      label: "Choke group",
      submenu: [0, 1, 2, 3, 4].map((g) => ({
        id: `choke${g}`,
        label: `${p.choke === g ? "✓" : "  "} ${g === 0 ? "None" : `Group ${g} (pads in it cut each other off)`}`,
        onSelect: () => void configurePad(p.index, p.gainDb, g),
      })),
    },
    { id: "clear", label: `Clear pad ${n}`, separator: true, danger: true, disabled: p.path === null, onSelect: () => void clearPad(p.index) },
  ];
}

function Pad({ pad, playing }: { pad: PadInfo; playing: boolean }): ReactNode {
  const n = pad.index + 1;
  // Remounted (see the key below) when the saved volume changes.
  const [gain, setGain] = useState(pad.gainDb);
  const timer = useRef(0);
  const loaded = pad.seconds !== null;

  const label = loaded ? pad.name : pad.error ? "Missing" : "Empty";
  return (
    <div
      data-drop="pad"
      data-drop-value={pad.index}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-bg p-1 data-[drop-active=true]:border-accent data-[drop-active=true]:bg-accent/10"
    >
      <button
        type="button"
        aria-label={`Pad ${n}: ${loaded ? pad.name : "empty"}`}
        aria-pressed={playing}
        title={
          loaded
            ? `Pad ${n}: ${pad.name} (${(pad.seconds ?? 0).toFixed(1)} s) — click or Alt+${n} to play; right-click for more`
            : `Pad ${n}: ${pad.error ?? "empty"} — drop a sound here, or right-click → Choose file…`
        }
        className={`flex h-11 min-w-0 flex-1 flex-col items-start justify-center rounded px-2 text-left ${
          playing ? "bg-accent text-bg" : loaded ? "bg-surface-raised hover:bg-accent/30" : "border border-dashed border-border text-muted hover:bg-surface-raised"
        }`}
        onClick={() => {
          if (loaded) void triggerPad(pad.index);
          else void choosePadFile(pad.index);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY, padMenu(pad, playing));
        }}
      >
        <span className="text-[11px] font-bold leading-none opacity-70">
          {n}
          {pad.choke !== 0 && ` · G${pad.choke}`}
        </span>
        <span className={`w-full truncate text-[12px] font-semibold ${pad.error && !loaded ? "text-danger" : ""}`}>{label}</span>
      </button>
      <Knob
        label={`VOL ${n}`}
        size={28}
        value={gain}
        min={-60}
        max={6}
        defaultValue={0}
        steps={66}
        format={dbText}
        hint={`pad ${n} volume`}
        onChange={(v) => {
          setGain(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            void configurePad(pad.index, v <= -60 ? -120 : v, pad.choke);
          }, 150);
        }}
      />
    </div>
  );
}

export function SamplerStrip(): ReactNode {
  const open = useStore(samplerOpen, (o) => o);
  const list = useStore(pads, (p) => p);
  const playing = useStore(status, (s) => s?.padsPlaying ?? 0);

  useEffect(() => {
    if (open) void refreshPads();
  }, [open]);

  if (!open) return null;
  return (
    <section aria-label="Sampler" className="flex w-full shrink-0 items-center gap-2 border-b border-border bg-surface px-2 py-1.5">
      <span className="text-[11px] font-bold tracking-wide text-muted">SAMPLER</span>
      <div className="flex min-w-0 flex-1 gap-1.5">
        {list.map((p) => (
          <Pad key={`${p.index}:${p.gainDb}`} pad={p} playing={(playing & (1 << p.index)) !== 0} />
        ))}
      </div>
      <button
        type="button"
        className="rounded bg-surface-raised px-2.5 py-1 text-[12px] font-semibold hover:bg-accent/30 disabled:opacity-40"
        title="Stop every pad"
        disabled={playing === 0}
        onClick={() => void stopPads(null)}
      >
        Stop all
      </button>
    </section>
  );
}
