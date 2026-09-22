import { describe, expect, it } from "vitest";
import { activeLyricLineIndex, pickKaraokeDeck } from "./karaokeLogic";
import type { ResolvedLyrics } from "../../services/lyrics";

describe("pickKaraokeDeck", () => {
  it("prefers whichever deck is actively playing", () => {
    expect(
      pickKaraokeDeck(
        { track: null, playbackState: "empty" },
        { track: { filePath: "b.mp3" } as never, playbackState: "playing" },
      ),
    ).toBe("b");
  });

  it("prefers deck A when both are playing", () => {
    expect(
      pickKaraokeDeck(
        { track: { filePath: "a.mp3" } as never, playbackState: "playing" },
        { track: { filePath: "b.mp3" } as never, playbackState: "playing" },
      ),
    ).toBe("a");
  });

  it("falls back to a loaded-but-not-playing deck A", () => {
    expect(
      pickKaraokeDeck(
        { track: { filePath: "a.mp3" } as never, playbackState: "paused" },
        { track: null, playbackState: "empty" },
      ),
    ).toBe("a");
  });

  it("falls back to deck B if only it has a track", () => {
    expect(
      pickKaraokeDeck(
        { track: null, playbackState: "empty" },
        { track: { filePath: "b.mp3" } as never, playbackState: "stopped" },
      ),
    ).toBe("b");
  });

  it("returns null when neither deck has a track", () => {
    expect(
      pickKaraokeDeck(
        { track: null, playbackState: "empty" },
        { track: null, playbackState: "empty" },
      ),
    ).toBeNull();
  });
});

describe("activeLyricLineIndex", () => {
  const synced: ResolvedLyrics = {
    source: "lrclib",
    synced: true,
    lines: [
      { timeSeconds: 0, text: "First" },
      { timeSeconds: 5, text: "Second" },
      { timeSeconds: 10, text: "Third" },
    ],
  };

  it("returns -1 before the first line's timestamp", () => {
    expect(activeLyricLineIndex(synced, -1)).toBe(-1);
  });

  it("returns the last line whose timestamp has passed", () => {
    expect(activeLyricLineIndex(synced, 6)).toBe(1);
  });

  it("returns the final line once past the last timestamp", () => {
    expect(activeLyricLineIndex(synced, 999)).toBe(2);
  });

  it("returns -1 for null lyrics", () => {
    expect(activeLyricLineIndex(null, 5)).toBe(-1);
  });

  it("returns -1 for unsynced lyrics", () => {
    const unsynced: ResolvedLyrics = {
      source: "id3",
      synced: false,
      lines: [{ timeSeconds: 0, text: "Plain" }],
    };
    expect(activeLyricLineIndex(unsynced, 5)).toBe(-1);
  });
});
