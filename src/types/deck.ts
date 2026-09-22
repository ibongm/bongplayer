/**
 * Domain types shared across the Zustand store slices (src/store/). Kept
 * here per AGENTS.md §3 rather than duplicated per-store.
 *
 * Note: src/services/midi/types.ts independently defines its own DeckId
 * ("a" | "b") and PadIndex (1-8) for the MIDI decode layer — same values,
 * different domain. Reconciling that duplication is a follow-up, not done
 * here to keep this phase scoped to the store slices.
 */

export type DeckId = "a" | "b";

export type EqBand = "low" | "mid" | "high";

/** A hot-cue or sampler slot number — the UI always has exactly 8 of each. */
export type SlotIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SLOT_INDEXES: readonly SlotIndex[] = [1, 2, 3, 4, 5, 6, 7, 8];
