import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import { useSamplerStore } from "../store/useSamplerStore";
import { getMasterGraph, deckEngineFor } from "../audio/masterGraph";
import { triggerSamplerSlot } from "../audio/samplerEngine";
import type { DeckId, SlotIndex } from "../types/deck";

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

/** Jumps to a hot cue if set, or sets one at the current position if empty — shared by CuePadMatrix (click) and MIDI hardware pads. */
export function activateHotCue(deck: DeckId, index: SlotIndex): void {
  const store = deckStoreFor(deck);
  const existing = store.getState().hotCues.find((cue) => cue.index === index);
  if (existing !== undefined) {
    deckEngineFor(getMasterGraph(), deck).seek(existing.positionSeconds);
    store.getState().seek(existing.positionSeconds);
  } else {
    store.getState().setHotCue(index, store.getState().currentTimeSeconds);
  }
}

/** Triggers a loaded sampler slot. No-op if empty — loading via file dialog is a UI-only affordance, not something MIDI can drive. */
export function activateSamplerSlot(index: SlotIndex): void {
  const slots = useSamplerStore.getState().slots;
  const slot = slots.find((entry) => entry.index === index);
  if (slot === undefined || slot.filePath === null) return;
  triggerSamplerSlot(index, slots);
}
