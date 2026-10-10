// ⚙ Settings window. Tabs are added as their features arrive; M4 brings the Audio tab.

import { useEffect, useState, type ReactNode } from "react";
import { backend } from "../../ipc/backend";
import type { OutputDevices } from "../../ipc/types";
import { notify } from "../../state/app";
import { useStore } from "../../state/store";
import { send, settingsOpen } from "../../state/ui";

const CEILING_KEY = "audio.limiter_ceiling";

function AudioTab(): ReactNode {
  const [devices, setDevices] = useState<OutputDevices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ceiling, setCeiling] = useState(-1);

  const load = (): void => {
    void backend()
      .outputDevices()
      .then((r) => {
        if (r.ok) {
          setDevices(r.value);
          setError(null);
        } else setError(r.error);
      });
  };

  useEffect(() => {
    load();
    void backend()
      .settingGet(CEILING_KEY)
      .then((r) => {
        if (r.ok && r.value !== null && Number.isFinite(Number(r.value))) setCeiling(Number(r.value));
      });
    const id = window.setInterval(load, 2000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const choose = async (id: string | null): Promise<void> => {
    const r = await backend().setPreferredOutput(id);
    if (!r.ok) {
      notify("error", `Output device: ${r.error}`);
      return;
    }
    notify("info", id === null ? "Output follows the Windows default device" : "Preferred output saved");
    load();
  };

  const applyCeiling = (v: number): void => {
    setCeiling(v);
    void send({ type: "limiterCeiling", db: v }, "Limiter");
    void backend().settingSet(CEILING_KEY, String(v));
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Output device</h3>
        <p className="mb-2 text-[12px] text-muted">
          At night choose the DDJ-400: music moves to it whenever it is plugged in, and falls back to the
          Windows default device if it disappears.
        </p>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        {devices && (
          <fieldset className="flex flex-col gap-1" aria-label="Preferred output device">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" name="out" checked={devices.preferred === null} onChange={() => void choose(null)} />
              Windows default device
            </label>
            {devices.devices.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="out" checked={devices.preferred === d.id} onChange={() => void choose(d.id)} />
                {d.name}
                {d.isDefault && <span className="text-[11px] text-muted">(Windows default)</span>}
                {devices.current?.id === d.id && <span className="text-[11px] text-accent">● playing</span>}
              </label>
            ))}
            {devices.preferred !== null && !devices.devices.some((d) => d.id === devices.preferred) && (
              <p className="text-[12px] text-muted">The preferred device is not plugged in; playing on the default.</p>
            )}
          </fieldset>
        )}
        {devices && (
          <p className="mt-2 text-[12px] text-muted">
            Now playing on: {devices.current?.name ?? "nothing"} at {devices.sampleRate} Hz
          </p>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Limiter ceiling</h3>
        <p className="mb-2 text-[12px] text-muted">The master output never goes above this level.</p>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="range"
            min={-12}
            max={0}
            step={0.1}
            value={ceiling}
            aria-label="Limiter ceiling"
            onChange={(e) => {
              applyCeiling(Number(e.target.value));
            }}
          />
          <span className="tabular-nums">{ceiling.toFixed(1)} dBFS</span>
        </label>
      </section>
    </div>
  );
}

// More sections join this list as their features arrive (M5–M11).
type TabId = string;
const TABS: { id: TabId; label: string; panel: () => ReactNode }[] = [
  { id: "audio", label: "Audio", panel: () => <AudioTab /> },
];

export function SettingsDialog(): ReactNode {
  const open = useStore(settingsOpen, (o) => o);
  const [tab, setTab] = useState<TabId>("audio");
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50"
      onKeyDown={(e) => {
        if (e.key === "Escape") settingsOpen.set(false);
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Settings" className="flex h-[70vh] w-[720px] max-w-[95vw] flex-col rounded-lg border border-border bg-surface shadow-2xl">
        <header className="flex items-center border-b border-border px-4 py-2">
          <h2 className="flex-1 text-[15px] font-semibold">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            title="Close (Esc)"
            className="rounded px-2 text-muted hover:text-text"
            onClick={() => {
              settingsOpen.set(false);
            }}
          >
            ✕
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="flex w-40 flex-col gap-1 border-r border-border p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`rounded px-2 py-1 text-left text-[13px] ${tab === t.id ? "bg-accent/25" : "hover:bg-surface-raised"}`}
                onClick={() => {
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-w-0 flex-1 overflow-y-auto p-4">
            {TABS.find((t) => t.id === tab)?.panel()}
          </div>
        </div>
      </div>
    </div>
  );
}
