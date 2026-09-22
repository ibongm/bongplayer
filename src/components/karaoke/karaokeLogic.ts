/**
 * Pure logic for KaraokeStage.tsx, split out so that file only exports the
 * component (fast-refresh requires a component-only module).
 */

import type { PlaybackState, TrackMetadata } from "../../store/createDeckStore";
import type { ResolvedLyrics } from "../../services/lyrics";
import type { DeckId } from "../../types/deck";

export interface DeckSnapshot {
  readonly track: TrackMetadata | null;
  readonly playbackState: PlaybackState;
}

/** Which deck the stage should follow: whichever is actively playing, else whichever has a track loaded (A preferred), else none. */
export function pickKaraokeDeck(deckA: DeckSnapshot, deckB: DeckSnapshot): DeckId | null {
  if (deckA.playbackState === "playing") return "a";
  if (deckB.playbackState === "playing") return "b";
  if (deckA.track !== null) return "a";
  if (deckB.track !== null) return "b";
  return null;
}

/** Index of the last lyric line whose timestamp has passed — -1 if none has, or the lyrics aren't synced. */
export function activeLyricLineIndex(
  lyrics: ResolvedLyrics | null,
  currentTimeSeconds: number,
): number {
  if (lyrics === null || !lyrics.synced) return -1;
  let index = -1;
  for (let i = 0; i < lyrics.lines.length; i++) {
    if (lyrics.lines[i].timeSeconds <= currentTimeSeconds) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}
