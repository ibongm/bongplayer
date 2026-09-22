import { describe, expect, it } from "vitest";
import { hotCueLedMessages, playCueLedMessages, samplerLedMessages } from "./ddj400Leds";
import type { HotCue, PlaybackState } from "../../store/createDeckStore";
import type { SamplerSlot } from "../../store/useSamplerStore";

function slot(index: SamplerSlot["index"], filePath: string | null): SamplerSlot {
  return { index, filePath, label: null, gainTrimDb: 0, chokeGroup: 0 };
}

describe("playCueLedMessages", () => {
  it("lights the play LED only while playing, on deck A's channel", () => {
    const messages = playCueLedMessages("a", "playing" as PlaybackState);
    expect(messages).toContainEqual({ status: 0x90, note: 0x0b, velocity: 127 });
  });

  it("dims the play LED when paused, on deck B's channel", () => {
    const messages = playCueLedMessages("b", "paused" as PlaybackState);
    expect(messages).toContainEqual({ status: 0x91, note: 0x0b, velocity: 0 });
  });

  it("dims the cue LED when no track is loaded", () => {
    const messages = playCueLedMessages("a", "empty" as PlaybackState);
    expect(messages).toContainEqual({ status: 0x90, note: 0x0c, velocity: 0 });
  });

  it("lights the cue LED once a track is loaded, even if stopped", () => {
    const messages = playCueLedMessages("a", "stopped" as PlaybackState);
    expect(messages).toContainEqual({ status: 0x90, note: 0x0c, velocity: 127 });
  });
});

describe("hotCueLedMessages", () => {
  const hotCues: readonly HotCue[] = [
    { index: 1, positionSeconds: 0, label: null },
    { index: 5, positionSeconds: 10, label: null },
  ];

  it("lights only the pads with a set hot cue, addressed on deck A's pad channel", () => {
    const messages = hotCueLedMessages("a", hotCues);
    expect(messages).toHaveLength(8);
    expect(messages.find((m) => m.note === 0x00)).toEqual({
      status: 0x97,
      note: 0x00,
      velocity: 127,
    });
    expect(messages.find((m) => m.note === 0x04)).toEqual({
      status: 0x97,
      note: 0x04,
      velocity: 127,
    });
    expect(messages.find((m) => m.note === 0x01)).toEqual({
      status: 0x97,
      note: 0x01,
      velocity: 0,
    });
  });

  it("addresses deck B's pad channel", () => {
    const messages = hotCueLedMessages("b", []);
    expect(messages.every((m) => m.status === 0x99)).toBe(true);
    expect(messages.every((m) => m.velocity === 0)).toBe(true);
  });
});

describe("samplerLedMessages", () => {
  it("lights pads with a loaded slot, using the 0x30+ note range", () => {
    const slots: readonly SamplerSlot[] = [
      slot(1, "/music/kick.wav"),
      slot(2, null),
      slot(3, "/music/snare.wav"),
      slot(4, null),
      slot(5, null),
      slot(6, null),
      slot(7, null),
      slot(8, null),
    ];

    const messages = samplerLedMessages("a", slots);
    expect(messages.find((m) => m.note === 0x30)).toEqual({
      status: 0x97,
      note: 0x30,
      velocity: 127,
    });
    expect(messages.find((m) => m.note === 0x31)).toEqual({
      status: 0x97,
      note: 0x31,
      velocity: 0,
    });
    expect(messages.find((m) => m.note === 0x32)).toEqual({
      status: 0x97,
      note: 0x32,
      velocity: 127,
    });
  });
});
