// Automix controls: start / stop, skip, trigger threshold, crossfade time, style,
// Loop / Shuffle / Auto-remove, and the latest message.

import type { ReactNode } from "react";
import { backend } from "../ipc/backend";
import type { AutomixConfig, TransitionStyle } from "../ipc/types";
import { notify, status } from "../state/app";
import { useStore } from "../state/store";

export const STYLES: { id: TransitionStyle; label: string; help: string }[] = [
  { id: "smooth", label: "Smooth", help: "equal-power crossfade" },
  { id: "bassSwap", label: "Bass Swap", help: "crossfade, bass swapped half way" },
  { id: "cut", label: "Cut", help: "instant switch" },
  { id: "echoOut", label: "Echo-Out", help: "old track echoes out, new one starts" },
];

const DEFAULT_CONFIG: AutomixConfig = {
  triggerSeconds: 8,
  crossfadeSeconds: 6,
  style: "smooth",
  loopQueue: true,
  shuffle: false,
  autoRemove: false,
};

async function act(p: Promise<{ ok: boolean; error?: string }>, what: string): Promise<void> {
  const r = await p;
  if (!r.ok) notify("error", `${what}: ${r.error ?? "failed"}`);
}

export function setAutomixConfig(change: Partial<AutomixConfig>): void {
  const cfg = status.get()?.automix.config ?? DEFAULT_CONFIG;
  void act(backend().automixConfig({ ...cfg, ...change }), "Automix setting");
}

export function toggleAutomix(): void {
  const on = status.get()?.automix.on ?? false;
  void act(on ? backend().automixStop() : backend().automixStart(), on ? "Stop Automix" : "Start Automix");
}

function Toggle({ label, title, on, onChange }: { label: string; title: string; on: boolean; onChange: (v: boolean) => void }): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      className={`rounded border px-2 py-0.5 text-[12px] font-semibold ${on ? "border-accent bg-accent/25" : "border-border bg-surface-raised text-muted hover:text-text"}`}
      onClick={() => {
        onChange(!on);
      }}
    >
      {label}
    </button>
  );
}

function Seconds({ label, value, min, max, title, onChange }: { label: string; value: number; min: number; max: number; title: string; onChange: (v: number) => void }): ReactNode {
  return (
    <label className="flex items-center gap-1 text-[12px]" title={title}>
      <span className="text-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={0.5}
        value={value}
        aria-label={label}
        className="w-14 rounded border border-border bg-bg px-1 py-0.5 text-right tabular-nums"
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
      <span className="text-muted">s</span>
    </label>
  );
}

export function AutomixCockpit(): ReactNode {
  const on = useStore(status, (s) => s?.automix.on ?? false);
  const cfgJson = useStore(status, (s) => JSON.stringify(s?.automix.config ?? DEFAULT_CONFIG));
  const message = useStore(status, (s) => s?.automix.message ?? null);
  const locked = useStore(status, (s) => s?.locked ?? false);
  const cfg = JSON.parse(cfgJson) as AutomixConfig;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-2" role="group" aria-label="Automix controls">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={on}
          disabled={locked}
          title={on ? "Stop Automix (the playing track continues)" : "Start Automix: play the queue with transitions"}
          className={`rounded px-3 py-1 text-[12px] font-bold disabled:opacity-40 ${on ? "bg-accent text-bg" : "bg-surface-raised hover:bg-accent/30"}`}
          onClick={toggleAutomix}
        >
          {on ? "■ AUTOMIX ON" : "▶ START AUTOMIX"}
        </button>
        <button
          type="button"
          disabled={!on || locked}
          title="Go to the next track now (with the chosen transition)"
          className="rounded bg-surface-raised px-2 py-1 text-[12px] font-semibold hover:bg-accent/30 disabled:opacity-40"
          onClick={() => void act(backend().automixSkip(), "Skip")}
        >
          ⏭ Skip
        </button>
        <select
          aria-label="Transition style"
          title="How one track blends into the next"
          value={cfg.style}
          disabled={locked}
          className="ml-auto rounded border border-border bg-bg px-1 py-0.5 text-[12px]"
          onChange={(e) => {
            const style = STYLES.find((x) => x.id === e.target.value)?.id;
            if (style) setAutomixConfig({ style });
          }}
        >
          {STYLES.map((st) => (
            <option key={st.id} value={st.id} title={st.help}>
              {st.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Seconds
          label="Trigger"
          value={cfg.triggerSeconds}
          min={1}
          max={60}
          title="Start the transition when the playing track has this many seconds left"
          onChange={(v) => {
            setAutomixConfig({ triggerSeconds: v });
          }}
        />
        <Seconds
          label="Fade"
          value={cfg.crossfadeSeconds}
          min={0}
          max={30}
          title="Length of the transition (never longer than the trigger time)"
          onChange={(v) => {
            setAutomixConfig({ crossfadeSeconds: v });
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <Toggle label="Loop" title="At the end of the queue, start again from the top" on={cfg.loopQueue} onChange={(v) => { setAutomixConfig({ loopQueue: v }); }} />
        <Toggle label="Shuffle" title="Play the queue in random order (each track once per round)" on={cfg.shuffle} onChange={(v) => { setAutomixConfig({ shuffle: v }); }} />
        <Toggle label="Auto-remove" title="Remove tracks from the queue once they have played" on={cfg.autoRemove} onChange={(v) => { setAutomixConfig({ autoRemove: v }); }} />
      </div>
      {message && (
        <p role="status" className="truncate text-[11px] text-muted" title={message}>
          {message}
        </p>
      )}
    </div>
  );
}
