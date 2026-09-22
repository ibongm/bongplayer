import { describe, expect, it } from "vitest";
import { resolveShortcut } from "./keyboardShortcuts";

describe("resolveShortcut", () => {
  it("maps Q/W to Deck A play-pause/cue", () => {
    expect(resolveShortcut({ key: "q", repeat: false })).toEqual({
      kind: "deckPlayPause",
      deck: "a",
    });
    expect(resolveShortcut({ key: "w", repeat: false })).toEqual({ kind: "deckCue", deck: "a" });
  });

  it("maps U/I to Deck B play-pause/cue", () => {
    expect(resolveShortcut({ key: "u", repeat: false })).toEqual({
      kind: "deckPlayPause",
      deck: "b",
    });
    expect(resolveShortcut({ key: "i", repeat: false })).toEqual({ kind: "deckCue", deck: "b" });
  });

  it("is case-insensitive", () => {
    expect(resolveShortcut({ key: "Q", repeat: false })).toEqual({
      kind: "deckPlayPause",
      deck: "a",
    });
  });

  it("maps 1-4 to Deck A hot cues 1-4 and 7-0 to Deck B hot cues 5-8", () => {
    expect(resolveShortcut({ key: "1", repeat: false })).toEqual({
      kind: "deckHotCue",
      deck: "a",
      index: 1,
    });
    expect(resolveShortcut({ key: "4", repeat: false })).toEqual({
      kind: "deckHotCue",
      deck: "a",
      index: 4,
    });
    expect(resolveShortcut({ key: "7", repeat: false })).toEqual({
      kind: "deckHotCue",
      deck: "b",
      index: 5,
    });
    expect(resolveShortcut({ key: "0", repeat: false })).toEqual({
      kind: "deckHotCue",
      deck: "b",
      index: 8,
    });
  });

  it("maps CapsLock to toggleShiftLock", () => {
    expect(resolveShortcut({ key: "CapsLock", repeat: false })).toEqual({
      kind: "toggleShiftLock",
    });
  });

  it("returns null for unmapped keys", () => {
    expect(resolveShortcut({ key: "z", repeat: false })).toBeNull();
    expect(resolveShortcut({ key: "5", repeat: false })).toBeNull();
    expect(resolveShortcut({ key: "Enter", repeat: false })).toBeNull();
  });

  it("ignores auto-repeat events (held keys)", () => {
    expect(resolveShortcut({ key: "q", repeat: true })).toBeNull();
  });
});
