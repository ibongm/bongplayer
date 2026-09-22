import { JogWheel } from "./JogWheel";
import { PitchSection } from "./PitchSection";
import { CuePadMatrix } from "./CuePadMatrix";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useDeckController } from "../../hooks/useDeckController";
import { useUIStore } from "../../store/useUIStore";
import type { DeckId } from "../../types/deck";

export interface DeckPanelProps {
  readonly deck: DeckId;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  return `${minutes}:${wholeSeconds.toString().padStart(2, "0")}`;
}

/** One deck's full control surface: jog wheel, pitch, cue/sampler pads, and transport. */
export function DeckPanel({ deck }: DeckPanelProps) {
  const store = deck === "a" ? useDeckAStore : useDeckBStore;
  const controller = useDeckController(deck);
  const track = store((state) => state.track);
  const playbackState = store((state) => state.playbackState);
  const currentTimeSeconds = store((state) => state.currentTimeSeconds);
  const isPlaying = playbackState === "playing";

  return (
    <div
      data-drop-zone={`deck-${deck}`}
      onContextMenu={(event) => {
        useUIStore
          .getState()
          .openContextMenu({ x: event.clientX, y: event.clientY, target: { kind: "deck", deck } });
      }}
      className="flex flex-1 flex-col items-center gap-3 p-3"
    >
      <div className="w-full truncate text-center text-sm text-textPrimary">
        {track?.title ?? `Deck ${deck.toUpperCase()} — empty`}
      </div>
      <span className="text-xs tabular-nums text-textMuted">
        {formatTime(currentTimeSeconds)}
        {track !== null ? ` / ${formatTime(track.duration)}` : ""}
      </span>

      <JogWheel deck={deck} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={isPlaying ? controller.pause : controller.play}
          disabled={track === null}
          className="rounded bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={controller.stop}
          disabled={playbackState === "empty"}
          className="rounded bg-surfaceRaised px-4 py-1.5 text-sm text-textPrimary hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cue
        </button>
      </div>

      <div className="w-full">
        <CuePadMatrix deck={deck} />
      </div>

      <PitchSection deck={deck} />
    </div>
  );
}
