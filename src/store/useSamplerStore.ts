import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { SLOT_INDEXES, type SlotIndex } from "../types/deck";

export type ChokeGroup = 0 | 1 | 2 | 3 | 4;

export interface SamplerSlot {
  readonly index: SlotIndex;
  readonly filePath: string | null;
  readonly label: string | null;
  readonly gainTrimDb: number;
  /** 0 means "no choke group" (doesn't cut off any other slot). */
  readonly chokeGroup: ChokeGroup;
}

export interface SamplerState {
  readonly slots: readonly SamplerSlot[];

  loadSlot(index: SlotIndex, filePath: string, label?: string | null): void;
  clearSlot(index: SlotIndex): void;
  setLabel(index: SlotIndex, label: string | null): void;
  setGainTrim(index: SlotIndex, db: number): void;
  setChokeGroup(index: SlotIndex, group: ChokeGroup): void;
}

function defaultSlot(index: SlotIndex): SamplerSlot {
  return { index, filePath: null, label: null, gainTrimDb: 0, chokeGroup: 0 };
}

function updateSlot(
  slots: readonly SamplerSlot[],
  index: SlotIndex,
  patch: Partial<SamplerSlot>,
): readonly SamplerSlot[] {
  return slots.map((slot) => (slot.index === index ? { ...slot, ...patch } : slot));
}

export const useSamplerStore = create<SamplerState>()(
  devtools(
    (set) => ({
      slots: SLOT_INDEXES.map(defaultSlot),

      loadSlot(index, filePath, label = null) {
        set(
          (state) => ({ slots: updateSlot(state.slots, index, { filePath, label }) }),
          false,
          "loadSlot",
        );
      },

      clearSlot(index) {
        set(
          (state) => ({
            slots: updateSlot(state.slots, index, { filePath: null, label: null }),
          }),
          false,
          "clearSlot",
        );
      },

      setLabel(index, label) {
        set((state) => ({ slots: updateSlot(state.slots, index, { label }) }), false, "setLabel");
      },

      setGainTrim(index, db) {
        set(
          (state) => ({ slots: updateSlot(state.slots, index, { gainTrimDb: db }) }),
          false,
          "setGainTrim",
        );
      },

      setChokeGroup(index, group) {
        set(
          (state) => ({ slots: updateSlot(state.slots, index, { chokeGroup: group }) }),
          false,
          "setChokeGroup",
        );
      },
    }),
    { name: "sampler" },
  ),
);
