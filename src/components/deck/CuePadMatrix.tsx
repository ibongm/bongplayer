import { useState } from "react";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useSamplerStore } from "../../store/useSamplerStore";
import { activateHotCue, activateSamplerSlot } from "../../services/padActions";
import { loadSamplerSlotViaDialog } from "../../services/samplerLoader";
import { useUIStore } from "../../store/useUIStore";
import { SLOT_INDEXES, type DeckId, type SlotIndex } from "../../types/deck";

export interface CuePadMatrixProps {
  readonly deck: DeckId;
}

type PadMode = "hotcue" | "sampler";

const HOT_CUE_LABELS: Readonly<Record<SlotIndex, string>> = {
  1: "A",
  2: "B",
  3: "C",
  4: "D",
  5: "E",
  6: "F",
  7: "G",
  8: "H",
};

/** 8-pad RGB matrix, switching between Hot Cues (A-H) and the 8-slot sampler (AGENTS §3, deck/CuePadMatrix.tsx). */
export function CuePadMatrix({ deck }: CuePadMatrixProps) {
  const [mode, setMode] = useState<PadMode>("hotcue");
  const deckStore = deck === "a" ? useDeckAStore : useDeckBStore;
  const hotCues = deckStore((state) => state.hotCues);
  const samplerSlots = useSamplerStore((state) => state.slots);

  function handleSamplerPad(index: SlotIndex): void {
    const slot = samplerSlots.find((entry) => entry.index === index);
    if (slot === undefined || slot.filePath === null) {
      void loadSamplerSlotViaDialog(index); // MIDI hardware can't open a file dialog — click-only.
    } else {
      activateSamplerSlot(index);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode("hotcue")}
          className={`flex-1 rounded px-2 py-1 text-xs ${
            mode === "hotcue" ? "bg-accent/30 text-accent" : "text-textMuted hover:bg-white/5"
          }`}
        >
          Hot Cues
        </button>
        <button
          type="button"
          onClick={() => setMode("sampler")}
          className={`flex-1 rounded px-2 py-1 text-xs ${
            mode === "sampler" ? "bg-accent/30 text-accent" : "text-textMuted hover:bg-white/5"
          }`}
        >
          Sampler
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {SLOT_INDEXES.map((index) => {
          if (mode === "hotcue") {
            const cue = hotCues.find((entry) => entry.index === index);
            return (
              <button
                key={index}
                type="button"
                onClick={() => activateHotCue(deck, index)}
                onContextMenu={(event) => {
                  useUIStore.getState().openContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    target: { kind: "deck", deck },
                  });
                }}
                className={`aspect-square rounded text-xs font-semibold ${
                  cue !== undefined
                    ? "bg-accent/70 text-black hover:bg-accent"
                    : "bg-surfaceRaised text-textMuted hover:bg-white/10"
                }`}
              >
                {HOT_CUE_LABELS[index]}
              </button>
            );
          }

          const slot = samplerSlots.find((entry) => entry.index === index);
          const loaded = slot !== undefined && slot.filePath !== null;
          return (
            <button
              key={index}
              type="button"
              onClick={() => handleSamplerPad(index)}
              onContextMenu={(event) => {
                useUIStore.getState().openContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  target: { kind: "samplerSlot", index },
                });
              }}
              title={slot?.label ?? undefined}
              className={`aspect-square rounded text-xs font-semibold ${
                loaded
                  ? "bg-cyan-500/60 text-black hover:bg-cyan-500/80"
                  : "bg-surfaceRaised text-textMuted hover:bg-white/10"
              }`}
            >
              {index}
            </button>
          );
        })}
      </div>
    </div>
  );
}
