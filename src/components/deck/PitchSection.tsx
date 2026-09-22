import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useDeckController } from "../../hooks/useDeckController";
import type { DeckId } from "../../types/deck";
import type { PitchRangePercent } from "../../utils/audioMath";

export interface PitchSectionProps {
  readonly deck: DeckId;
}

const PITCH_RANGES: readonly PitchRangePercent[] = [8, 16, 50];
const DETENT_FRACTION = 0.02; // snap to 0% within the innermost 2% of the fader's travel
const BEND_PERCENT = 2;

/** Vertical pitch fader with center detent, momentary bend buttons, and Key Lock (AGENTS §3, deck/PitchSection.tsx). */
export function PitchSection({ deck }: PitchSectionProps) {
  const store = deck === "a" ? useDeckAStore : useDeckBStore;
  const controller = useDeckController(deck);
  const pitchPercent = store((state) => state.pitchPercent);
  const pitchRange = store((state) => state.pitchRange);
  const keyLockEnabled = store((state) => state.keyLockEnabled);
  const setPitchPercent = store((state) => state.setPitchPercent);
  const setPitchRange = store((state) => state.setPitchRange);
  const toggleKeyLock = store((state) => state.toggleKeyLock);

  function handleFaderChange(value: number): void {
    const detentThreshold = pitchRange * DETENT_FRACTION;
    setPitchPercent(Math.abs(value) < detentThreshold ? 0 : value);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-1">
        {PITCH_RANGES.map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => setPitchRange(range)}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              pitchRange === range ? "bg-accent/30 text-accent" : "text-textMuted hover:bg-white/5"
            }`}
          >
            ±{range}%
          </button>
        ))}
      </div>

      <input
        type="range"
        min={-pitchRange}
        max={pitchRange}
        step={0.1}
        value={pitchPercent}
        onChange={(event) => handleFaderChange(Number(event.target.value))}
        style={{ writingMode: "vertical-lr", direction: "rtl" }}
        className="h-36 w-5 cursor-pointer accent-accent"
      />

      <span className="text-xs tabular-nums text-textPrimary">
        {pitchPercent > 0 ? "+" : ""}
        {pitchPercent.toFixed(1)}%
      </span>

      <div className="flex gap-1">
        <button
          type="button"
          onPointerDown={() => controller.bendStart(-BEND_PERCENT)}
          onPointerUp={controller.bendEnd}
          onPointerLeave={controller.bendEnd}
          className="rounded bg-surfaceRaised px-2 py-1 text-xs text-textPrimary hover:bg-white/10 active:bg-accent/30"
        >
          −
        </button>
        <button
          type="button"
          onPointerDown={() => controller.bendStart(BEND_PERCENT)}
          onPointerUp={controller.bendEnd}
          onPointerLeave={controller.bendEnd}
          className="rounded bg-surfaceRaised px-2 py-1 text-xs text-textPrimary hover:bg-white/10 active:bg-accent/30"
        >
          +
        </button>
      </div>

      <button
        type="button"
        onClick={toggleKeyLock}
        aria-pressed={keyLockEnabled}
        className={`rounded px-2 py-1 text-xs ${
          keyLockEnabled
            ? "bg-accent/30 text-accent"
            : "bg-surfaceRaised text-textMuted hover:bg-white/10"
        }`}
      >
        Key Lock
      </button>
    </div>
  );
}
