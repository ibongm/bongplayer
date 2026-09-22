/**
 * DJ-standard keymap (AGENTS §3/Risk #7). No single convention is universal
 * across DJ software, so this is a deliberate, documented choice rather
 * than a copy of one specific product: Q/W sit near the left hand for Deck
 * A, U/I mirror them near the right hand for Deck B, and the number row
 * splits 1-4 (Deck A) / 7-0 (Deck B) for hot cues.
 */

import type { DeckId, SlotIndex } from "../types/deck";

export type ShortcutAction =
  | { readonly kind: "deckPlayPause"; readonly deck: DeckId }
  | { readonly kind: "deckCue"; readonly deck: DeckId }
  | { readonly kind: "deckHotCue"; readonly deck: DeckId; readonly index: SlotIndex }
  | { readonly kind: "toggleShiftLock" };

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly repeat: boolean;
}

const DECK_A_HOTCUE_KEYS: Readonly<Record<string, SlotIndex>> = { "1": 1, "2": 2, "3": 3, "4": 4 };
const DECK_B_HOTCUE_KEYS: Readonly<Record<string, SlotIndex>> = { "7": 5, "8": 6, "9": 7, "0": 8 };

/** Pure keymap resolution — no DOM access, fully unit-testable. */
export function resolveShortcut(event: ShortcutKeyEvent): ShortcutAction | null {
  if (event.repeat) return null;
  const key = event.key.toLowerCase();

  if (key === "q") return { kind: "deckPlayPause", deck: "a" };
  if (key === "w") return { kind: "deckCue", deck: "a" };
  if (key === "u") return { kind: "deckPlayPause", deck: "b" };
  if (key === "i") return { kind: "deckCue", deck: "b" };
  if (key === "capslock") return { kind: "toggleShiftLock" };

  if (key in DECK_A_HOTCUE_KEYS) {
    return { kind: "deckHotCue", deck: "a", index: DECK_A_HOTCUE_KEYS[key] };
  }
  if (key in DECK_B_HOTCUE_KEYS) {
    return { kind: "deckHotCue", deck: "b", index: DECK_B_HOTCUE_KEYS[key] };
  }

  return null;
}

/** Whether a keydown originating from this target should be treated as text entry, not a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
