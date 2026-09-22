import { useMixerStore } from "../../store/useMixerStore";
import { useUIStore } from "../../store/useUIStore";
import type { DeckId, EqBand } from "../../types/deck";

export interface ChannelStripProps {
  readonly deck: DeckId;
}

const EQ_BANDS: readonly EqBand[] = ["high", "mid", "low"];
const EQ_LABELS: Readonly<Record<EqBand, string>> = { high: "HI", mid: "MID", low: "LOW" };

/** Trim, 3-band EQ + kills, bipolar filter, PFL, and volume fader for one deck's channel (AGENTS §3, mixer/ChannelStrip.tsx). */
export function ChannelStrip({ deck }: ChannelStripProps) {
  const channel = useMixerStore((state) => state.channels[deck]);
  const setTrim = useMixerStore((state) => state.setTrim);
  const setEqGain = useMixerStore((state) => state.setEqGain);
  const setEqKilled = useMixerStore((state) => state.setEqKilled);
  const setFilterPosition = useMixerStore((state) => state.setFilterPosition);
  const setVolumeFader = useMixerStore((state) => state.setVolumeFader);
  const setPfl = useMixerStore((state) => state.setPfl);

  function openKnobMenu(event: React.MouseEvent, label: string, onReset: () => void): void {
    useUIStore.getState().openContextMenu({
      x: event.clientX,
      y: event.clientY,
      target: { kind: "knob", label, onReset },
    });
  }

  return (
    <div className="flex flex-col items-center gap-2 p-2">
      <span className="text-xs font-semibold text-textMuted">{deck.toUpperCase()}</span>

      <label className="flex flex-col items-center gap-1">
        <span className="text-[10px] text-textMuted">Trim</span>
        <input
          type="range"
          min={-12}
          max={12}
          step={0.1}
          value={channel.trimDb}
          onChange={(event) => setTrim(deck, Number(event.target.value))}
          onContextMenu={(event) => openKnobMenu(event, "Trim", () => setTrim(deck, 0))}
          className="w-16 accent-accent"
        />
      </label>

      {EQ_BANDS.map((band) => (
        <div key={band} className="flex items-center gap-1.5">
          <input
            type="range"
            min={-24}
            max={6}
            step={0.1}
            value={channel.eq[band]}
            onChange={(event) => setEqGain(deck, band, Number(event.target.value))}
            onContextMenu={(event) =>
              openKnobMenu(event, `${EQ_LABELS[band]} EQ`, () => setEqGain(deck, band, 0))
            }
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
            className="h-14 w-4 accent-accent"
          />
          <button
            type="button"
            onClick={() => setEqKilled(deck, band, !channel.eqKilled[band])}
            title={`Kill ${EQ_LABELS[band]}`}
            aria-label={`Kill ${EQ_LABELS[band]}`}
            aria-pressed={channel.eqKilled[band]}
            className={`h-4 w-4 rounded-full ${channel.eqKilled[band] ? "bg-red-500" : "bg-surfaceRaised hover:bg-white/20"}`}
          />
        </div>
      ))}

      <label className="flex flex-col items-center gap-1">
        <span className="text-[10px] text-textMuted">Filter</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={channel.filterPosition}
          onChange={(event) => setFilterPosition(deck, Number(event.target.value))}
          onContextMenu={(event) => openKnobMenu(event, "Filter", () => setFilterPosition(deck, 0))}
          className="w-16 accent-accent"
        />
      </label>

      <button
        type="button"
        onClick={() => setPfl(deck, !channel.pflEnabled)}
        aria-pressed={channel.pflEnabled}
        className={`rounded px-2 py-0.5 text-[10px] ${
          channel.pflEnabled ? "bg-accent/30 text-accent" : "text-textMuted hover:bg-white/5"
        }`}
      >
        PFL
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={channel.volumeFader}
        onChange={(event) => setVolumeFader(deck, Number(event.target.value))}
        onContextMenu={(event) => openKnobMenu(event, "Volume", () => setVolumeFader(deck, 1))}
        style={{ writingMode: "vertical-lr", direction: "rtl" }}
        className="h-24 w-5 accent-accent"
      />
    </div>
  );
}
