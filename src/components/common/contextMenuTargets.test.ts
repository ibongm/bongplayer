import { beforeEach, describe, expect, it } from "vitest";
import { resolveContextMenuItems } from "./contextMenuTargets";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useAutomixStore } from "../../store/useAutomixStore";
import { useSamplerStore } from "../../store/useSamplerStore";
import type { TrackMetadata } from "../../store/createDeckStore";

const TRACK: TrackMetadata = {
  filePath: "C:/Music/track.mp3",
  title: "Track",
  artist: null,
  duration: 120,
  bpm: null,
  key: null,
  sampleRate: 44100,
};

beforeEach(() => {
  useDeckAStore.setState(useDeckAStore.getInitialState(), true);
  useAutomixStore.setState(useAutomixStore.getInitialState(), true);
  useSamplerStore.setState(useSamplerStore.getInitialState(), true);
});

describe("resolveContextMenuItems", () => {
  it("deck: disables Clear/Eject and Clear Hot Cues when there's nothing to clear", () => {
    const items = resolveContextMenuItems({ kind: "deck", deck: "a" });
    expect(items.find((item) => item.id === "clear")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "clearHotCues")?.disabled).toBe(true);
  });

  it("deck: Clear/Eject Track actually clears the deck's track", () => {
    useDeckAStore.getState().loadTrack(TRACK);
    const items = resolveContextMenuItems({ kind: "deck", deck: "a" });

    items.find((item) => item.id === "clear")?.onSelect();

    expect(useDeckAStore.getState().track).toBeNull();
  });

  it("deck: Reset Pitch sets pitch back to 0", () => {
    useDeckAStore.getState().setPitchPercent(4);
    resolveContextMenuItems({ kind: "deck", deck: "a" })
      .find((item) => item.id === "resetPitch")
      ?.onSelect();
    expect(useDeckAStore.getState().pitchPercent).toBe(0);
  });

  it("automixRow: Remove Track removes only the targeted queue entry", () => {
    useAutomixStore.getState().enqueue({ filePath: "/a.mp3", fileName: "a.mp3" });
    useAutomixStore.getState().enqueue({ filePath: "/b.mp3", fileName: "b.mp3" });
    const [first, second] = useAutomixStore.getState().queue;

    resolveContextMenuItems({ kind: "automixRow", queueId: first.id })
      .find((item) => item.id === "remove")
      ?.onSelect();

    expect(useAutomixStore.getState().queue).toEqual([second]);
  });

  it("automixRow: Clear Entire Queue is marked destructive and empties the queue", () => {
    useAutomixStore.getState().enqueue({ filePath: "/a.mp3", fileName: "a.mp3" });
    const items = resolveContextMenuItems({ kind: "automixRow", queueId: "irrelevant" });
    const clearItem = items.find((item) => item.id === "clearQueue");

    expect(clearItem?.destructive).toBe(true);
    clearItem?.onSelect();
    expect(useAutomixStore.getState().queue).toHaveLength(0);
  });

  it("knob: wraps the given onReset callback under a labeled item", () => {
    let resetCalled = false;
    const items = resolveContextMenuItems({
      kind: "knob",
      label: "Trim",
      onReset: () => {
        resetCalled = true;
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Reset Trim");
    items[0].onSelect();
    expect(resetCalled).toBe(true);
  });

  it("samplerSlot: Clear Slot is disabled when the slot is already empty", () => {
    const items = resolveContextMenuItems({ kind: "samplerSlot", index: 1 });
    expect(items.find((item) => item.id === "clear")?.disabled).toBe(true);
  });

  it("samplerSlot: lists all 5 choke-group options and disables the currently-active one", () => {
    useSamplerStore.getState().setChokeGroup(2, 3);
    const items = resolveContextMenuItems({ kind: "samplerSlot", index: 2 });

    const chokeItems = items.filter((item) => item.id.startsWith("choke-"));
    expect(chokeItems).toHaveLength(5);
    expect(chokeItems.find((item) => item.id === "choke-3")?.disabled).toBe(true);
    expect(chokeItems.find((item) => item.id === "choke-0")?.disabled).toBe(false);
  });

  it("samplerSlot: selecting a choke-group item updates the store", () => {
    resolveContextMenuItems({ kind: "samplerSlot", index: 4 })
      .find((item) => item.id === "choke-2")
      ?.onSelect();

    expect(useSamplerStore.getState().slots[3].chokeGroup).toBe(2);
  });
});
