/**
 * Lyrics resolution (Phase 8): 3 sources in priority order — a local cache
 * (instant, no re-fetch), embedded ID3v2 lyrics (works offline, decoded by
 * src-tauri/src/commands/lyrics.rs), then LRCLIB (lrclib.net — no API key,
 * the best source of real *synced* lyrics for most tracks). Returns null if
 * none of the three have anything for a track.
 */

import { readFile } from "@tauri-apps/plugin-fs";
import { callCommand } from "./ipc";

export interface LyricLine {
  readonly timeSeconds: number;
  readonly text: string;
}

export interface ResolvedLyrics {
  readonly source: "cache" | "id3" | "lrclib";
  /** True when lines carry real per-line timestamps (LRC-format or synced LRCLIB result); false for plain, unsynced text. */
  readonly synced: boolean;
  readonly lines: readonly LyricLine[];
}

const CACHE_PREFIX = "bongplayer:lyrics:";
// ID3v2 tags live at the start of the file and declare their own total
// size in the header — this bound just keeps the IPC payload small for the
// (rare) file with an unusually large tag.
const ID3_PREFIX_BYTES = 2_000_000;

function cacheKey(filePath: string): string {
  return CACHE_PREFIX + filePath;
}

export function readLyricsCache(filePath: string): ResolvedLyrics | null {
  try {
    const raw = localStorage.getItem(cacheKey(filePath));
    return raw === null ? null : (JSON.parse(raw) as ResolvedLyrics);
  } catch {
    return null;
  }
}

function writeLyricsCache(filePath: string, lyrics: ResolvedLyrics): void {
  try {
    localStorage.setItem(cacheKey(filePath), JSON.stringify(lyrics));
  } catch {
    // best-effort — a full/unavailable localStorage just means no caching this run
  }
}

const LRC_TIMESTAMP = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

/** Parses standard LRC `[mm:ss.xx]`/`[mm:ss]` timestamps (one or more per line). Lines without a timestamp are dropped — not meaningful for a synced stage. */
export function parseLrc(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of lrcText.split(/\r?\n/)) {
    LRC_TIMESTAMP.lastIndex = 0;
    const matches = [...rawLine.matchAll(LRC_TIMESTAMP)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(LRC_TIMESTAMP, "").trim();
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] === undefined ? 0 : Number(`0.${match[3]}`);
      lines.push({ timeSeconds: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function linesFromPlainText(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ timeSeconds: 0, text: line }));
}

async function resolveFromId3(filePath: string): Promise<ResolvedLyrics | null> {
  try {
    const bytes = await readFile(filePath);
    const prefix = Array.from(bytes.subarray(0, ID3_PREFIX_BYTES));
    const result = await callCommand<string | null>("read_embedded_lyrics", { bytes: prefix });
    if (!result.ok || result.data === null || result.data.trim().length === 0) return null;
    const synced = parseLrc(result.data);
    return synced.length > 0
      ? { source: "id3", synced: true, lines: synced }
      : { source: "id3", synced: false, lines: linesFromPlainText(result.data) };
  } catch (error) {
    console.error(`ID3 lyrics lookup failed for "${filePath}":`, error);
    return null;
  }
}

async function resolveFromLrclib(
  artist: string,
  title: string,
  durationSeconds: number,
): Promise<ResolvedLyrics | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    duration: String(Math.round(durationSeconds)),
  });
  const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
  };
  if (body.syncedLyrics !== undefined && body.syncedLyrics !== null) {
    return { source: "lrclib", synced: true, lines: parseLrc(body.syncedLyrics) };
  }
  if (body.plainLyrics !== undefined && body.plainLyrics !== null) {
    return { source: "lrclib", synced: false, lines: linesFromPlainText(body.plainLyrics) };
  }
  return null;
}

export async function resolveLyrics(
  filePath: string,
  artist: string | null,
  title: string,
  durationSeconds: number,
): Promise<ResolvedLyrics | null> {
  const cached = readLyricsCache(filePath);
  if (cached !== null) return cached;

  const fromId3 = await resolveFromId3(filePath);
  if (fromId3 !== null) {
    writeLyricsCache(filePath, fromId3);
    return fromId3;
  }

  if (artist !== null) {
    try {
      const fromLrclib = await resolveFromLrclib(artist, title, durationSeconds);
      if (fromLrclib !== null) {
        writeLyricsCache(filePath, fromLrclib);
        return fromLrclib;
      }
    } catch (error) {
      console.error(`LRCLIB lookup failed for "${title}":`, error);
    }
  }

  return null;
}
