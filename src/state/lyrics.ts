// Lyrics for the karaoke views: fetched from Rust once per track, the deck the audience
// hears ("active deck"), and the line under the playhead.

import { backend } from "../ipc/backend";
import type { IpcResult, LyricLine, Lyrics, StatusSnapshot } from "../ipc/types";
import { createStore } from "./store";

/** The LRC drawer (big lyrics over the dock), toggled by the LRC button. */
export const lyricsDrawer = createStore(false);

const cache = new Map<number, Lyrics | null>();

/** Lyrics of a track (null when it has none). Answers are kept for the session. */
export async function lyricsFor(trackId: number): Promise<IpcResult<Lyrics | null>> {
  const hit = cache.get(trackId);
  if (hit !== undefined) return { ok: true, value: hit };
  const r = await backend().trackLyrics(trackId);
  if (r.ok) cache.set(trackId, r.value);
  return r;
}

export function clearLyricsCache(): void {
  cache.clear();
}

/**
 * The deck whose lyrics to show: the only playing deck; if both play, the one the
 * crossfader favours; if neither plays, the loaded one (A first). Null when both are empty.
 */
export function activeDeck(s: StatusSnapshot | null): 0 | 1 | null {
  if (!s) return null;
  const [a, b] = s.decks;
  if (a.playing && !b.playing) return 0;
  if (b.playing && !a.playing) return 1;
  if (a.playing && b.playing) return s.crossfader > 0.5 ? 1 : 0;
  if (a.loaded) return 0;
  if (b.loaded) return 1;
  return null;
}

/** Index of the line being sung at `seconds` (−1 before the first line). */
export function currentLine(lines: LyricLine[], seconds: number): number {
  const ms = seconds * 1000;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (line && line.ms <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
