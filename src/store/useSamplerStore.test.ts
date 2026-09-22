import { beforeEach, describe, expect, it } from "vitest";
import { useSamplerStore } from "./useSamplerStore";

beforeEach(() => {
  useSamplerStore.setState(useSamplerStore.getInitialState(), true);
});

describe("useSamplerStore", () => {
  it("starts with 8 empty slots, indexed 1-8", () => {
    const slots = useSamplerStore.getState().slots;
    expect(slots).toHaveLength(8);
    expect(slots.map((slot) => slot.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(slots.every((slot) => slot.filePath === null)).toBe(true);
  });

  it("loadSlot sets the file/label for only the targeted slot", () => {
    useSamplerStore.getState().loadSlot(3, "/kick.wav", "Kick");

    const slots = useSamplerStore.getState().slots;
    expect(slots[2]).toMatchObject({ index: 3, filePath: "/kick.wav", label: "Kick" });
    expect(slots[0].filePath).toBeNull();
  });

  it("clearSlot empties the file/label but keeps gain and choke group", () => {
    useSamplerStore.getState().loadSlot(1, "/kick.wav", "Kick");
    useSamplerStore.getState().setGainTrim(1, -6);
    useSamplerStore.getState().setChokeGroup(1, 2);

    useSamplerStore.getState().clearSlot(1);

    const slot = useSamplerStore.getState().slots[0];
    expect(slot.filePath).toBeNull();
    expect(slot.label).toBeNull();
    expect(slot.gainTrimDb).toBe(-6);
    expect(slot.chokeGroup).toBe(2);
  });

  it("setGainTrim and setChokeGroup update only the targeted slot", () => {
    useSamplerStore.getState().setGainTrim(5, -3);
    useSamplerStore.getState().setChokeGroup(5, 4);

    const slots = useSamplerStore.getState().slots;
    expect(slots[4]).toMatchObject({ gainTrimDb: -3, chokeGroup: 4 });
    expect(slots[0]).toMatchObject({ gainTrimDb: 0, chokeGroup: 0 });
  });
});
