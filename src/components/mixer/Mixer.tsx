// Centre mixer: per channel gain, 3-band EQ with kills, filter, meter and fader; master
// level and meter; crossfader.

import { useEffect, useRef, type ReactNode } from "react";
import type { DeckName } from "../../ipc/types";
import { status } from "../../state/app";
import { useStore } from "../../state/store";
import { channelDefaults, context2d, cssColor, mixer, onFrame, setChannel, setCrossfader, setMaster } from "../../state/ui";
import { Fader } from "../controls/Fader";
import { Knob } from "../controls/Knob";

const db = (v: number): string => (v <= -24 ? "−∞ dB" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`);

/** Linear level → 0…1 meter height (−60 dB … 0 dB). */
export function meterHeight(level: number): number {
  if (level <= 0) return 0;
  const dbv = 20 * Math.log10(level);
  return Math.max(0, Math.min(1, (dbv + 60) / 60));
}

function Meter({ source, label }: { source: 0 | 1 | 2; label: string }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const peakHold = useRef({ v: 0, at: 0 });
  useEffect(
    () =>
      onFrame((now) => {
        const ctx = context2d(ref.current);
        const c = ref.current;
        if (!ctx || !c) return;
        const s = status.get();
        const [peak, rms] = source === 2 ? (s?.master ?? [0, 0]) : (s?.decks[source].meter ?? [0, 0]);
        const w = c.clientWidth;
        const h = c.clientHeight;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = cssColor("--color-bg");
        ctx.fillRect(0, 0, w, h);
        const r = meterHeight(rms) * h;
        const p = meterHeight(peak);
        if (p >= peakHold.current.v || now - peakHold.current.at > 1200) peakHold.current = { v: p, at: now };
        ctx.fillStyle = cssColor("--color-accent");
        ctx.fillRect(0, h - r, w, r);
        ctx.fillStyle = peakHold.current.v > 0.98 ? cssColor("--color-danger") : cssColor("--color-text");
        ctx.fillRect(0, h - peakHold.current.v * h, w, 2);
      }),
    [source],
  );
  return <canvas ref={ref} role="img" aria-label={label} title={`${label} (−60 … 0 dBFS; line = peak)`} className="h-full min-h-24 w-2.5 rounded-sm" />;
}

function Kill({ deck, band, label }: { deck: DeckName; band: "killHigh" | "killMid" | "killLow"; label: string }): ReactNode {
  const on = useStore(mixer, (m) => m[deck][band]);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${label} kill deck ${deck}`}
      title={`Kill ${label.toLowerCase()} on deck ${deck} (mute that band)`}
      className={`h-5 w-7 rounded text-[10px] font-bold ${on ? "bg-danger text-danger-text" : "bg-surface-raised text-muted hover:bg-danger/40"}`}
      onClick={() => {
        setChannel(deck, band, !on);
      }}
    >
      K
    </button>
  );
}

function Channel({ deck }: { deck: DeckName }): ReactNode {
  const ch = useStore(mixer, (m) => m[deck]);
  const band = (key: "high" | "mid" | "low", kill: "killHigh" | "killMid" | "killLow", label: string): ReactNode => (
    <div className="flex items-center gap-1">
      <Knob
        label={label}
        size={34}
        bipolar
        value={ch[key]}
        min={-24}
        max={6}
        defaultValue={0}
        steps={60}
        format={db}
        onChange={(v) => {
          setChannel(deck, key, v <= -24 ? -120 : v);
        }}
      />
      <Kill deck={deck} band={kill} label={label} />
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-1.5" role="group" aria-label={`Channel ${deck}`}>
      <span className="text-[13px] font-black text-accent">{deck}</span>
      <Knob
        label="GAIN"
        size={34}
        bipolar
        value={ch.trim}
        min={-24}
        max={12}
        defaultValue={channelDefaults.trim}
        steps={72}
        format={db}
        onChange={(v) => {
          setChannel(deck, "trim", v);
        }}
      />
      {band("high", "killHigh", "HI")}
      {band("mid", "killMid", "MID")}
      {band("low", "killLow", "LOW")}
      <Knob
        label="FILTER"
        size={34}
        bipolar
        value={ch.filter}
        min={-1}
        max={1}
        defaultValue={0}
        steps={40}
        format={(v) => (Math.abs(v) < 0.02 ? "off" : v < 0 ? `low-pass ${Math.round(-v * 100)} %` : `high-pass ${Math.round(v * 100)} %`)}
        onChange={(v) => {
          setChannel(deck, "filter", Math.abs(v) < 0.02 ? 0 : v);
        }}
      />
      <div className="flex items-end gap-1">
        <Meter source={deck === "A" ? 0 : 1} label={`Deck ${deck} level`} />
        <Fader
          label="VOL"
          orientation="vertical"
          length={120}
          value={ch.fader}
          min={0}
          max={1}
          defaultValue={1}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => {
            setChannel(deck, "fader", v);
          }}
        />
      </div>
    </div>
  );
}

export function Mixer(): ReactNode {
  const crossfader = useStore(mixer, (m) => m.crossfader);
  const master = useStore(mixer, (m) => m.master);
  return (
    <section aria-label="Mixer" className="flex shrink-0 flex-col items-center gap-2 rounded-md border border-border bg-surface p-2">
      <div role="tablist" aria-label="Mixer tabs" className="flex gap-1 text-[11px] font-semibold">
        <span role="tab" aria-selected="true" className="rounded bg-accent/25 px-2 py-0.5">
          MIX
        </span>
      </div>
      <div className="flex items-start gap-3">
        <Channel deck="A" />
        <div className="flex flex-col items-center gap-1.5 pt-6" role="group" aria-label="Master">
          <Knob
            label="MASTER"
            size={40}
            bipolar
            value={master}
            min={-24}
            max={6}
            defaultValue={0}
            steps={60}
            format={db}
            onChange={(v) => {
              setMaster(v <= -24 ? -120 : v);
            }}
          />
          <div className="flex h-40 gap-1">
            <Meter source={2} label="Master level" />
          </div>
        </div>
        <Channel deck="B" />
      </div>
      <Fader
        label="CROSSFADER"
        orientation="horizontal"
        length={200}
        centreMark
        value={crossfader}
        min={0}
        max={1}
        defaultValue={0.5}
        format={(v) => (Math.abs(v - 0.5) < 0.01 ? "centre" : v < 0.5 ? `towards A ${Math.round((0.5 - v) * 200)} %` : `towards B ${Math.round((v - 0.5) * 200)} %`)}
        onChange={setCrossfader}
      />
    </section>
  );
}
