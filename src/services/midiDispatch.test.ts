import { beforeEach, describe, expect, it } from "vitest";
import { applyDeckAction } from "./midiDispatch";
import { useDeckAStore } from "../store/useDeckAStore";
import { useMixerStore } from "../store/useMixerStore";
import type { TrackMetadata } from "../store/createDeckStore";

const TRACK: TrackMetadata = {
  filePath: "C:/Music/track.mp3",
  title: "Track",
  artist: null,
  duration: 200,
  bpm: null,
  key: null,
  sampleRate: 44100,
};

beforeEach(() => {
  useDeckAStore.setState(useDeckAStore.getInitialState(), true);
  useMixerStore.setState(useMixerStore.getInitialState(), true);
});

describe("applyDeckAction", () => {
  it("ignores play/pause/cue/hotcue/sampler button-up edges (down: false)", () => {
    useDeckAStore.getState().loadTrack(TRACK);
    applyDeckAction({ type: "play", deck: "a", down: false });
    expect(useDeckAStore.getState().playbackState).toBe("stopped");
  });

  it("play is a no-op when no track is loaded on that deck", () => {
    applyDeckAction({ type: "play", deck: "a", down: true });
    expect(useDeckAStore.getState().playbackState).toBe("empty");
  });

  it("pitch maps the normalized [-1,1] value against the deck's current pitch range", () => {
    useDeckAStore.getState().setPitchRange(16);
    applyDeckAction({ type: "pitch", deck: "a", value14: 0, normalized: 0.5 });
    expect(useDeckAStore.getState().pitchPercent).toBeCloseTo(8, 6); // 0.5 * 16
  });

  it("jog nudges currentTimeSeconds, scaled per mode", () => {
    useDeckAStore.getState().loadTrack(TRACK);
    useDeckAStore.getState().tick(10);
    applyDeckAction({ type: "jog", deck: "a", delta: 4, mode: "search" });
    // search = 0.5s/tick -> 10 + 4*0.5 = 12
    expect(useDeckAStore.getState().currentTimeSeconds).toBeCloseTo(12, 6);
  });

  it("eq maps normalized [0,1] to the -24..+6 dB range", () => {
    applyDeckAction({ type: "eq", deck: "a", band: "low", value: 1 });
    expect(useMixerStore.getState().channels.a.eq.low).toBeCloseTo(6, 6);
    applyDeckAction({ type: "eq", deck: "a", band: "low", value: 0 });
    expect(useMixerStore.getState().channels.a.eq.low).toBeCloseTo(-24, 6);
  });

  it("filter maps normalized [0,1] to bipolar [-1,1]", () => {
    applyDeckAction({ type: "filter", deck: "a", value: 0 });
    expect(useMixerStore.getState().channels.a.filterPosition).toBeCloseTo(-1, 6);
    applyDeckAction({ type: "filter", deck: "a", value: 1 });
    expect(useMixerStore.getState().channels.a.filterPosition).toBeCloseTo(1, 6);
  });

  it("crossfade and volume set the store directly", () => {
    applyDeckAction({ type: "crossfade", value: 0.75 });
    expect(useMixerStore.getState().crossfaderPosition).toBeCloseTo(0.75, 6);
    applyDeckAction({ type: "volume", deck: "a", value: 0.4 });
    expect(useMixerStore.getState().channels.a.volumeFader).toBeCloseTo(0.4, 6);
  });

  it("hotcue sets a cue at the current position when empty, on the press edge only", () => {
    useDeckAStore.getState().loadTrack(TRACK);
    useDeckAStore.getState().tick(42);
    applyDeckAction({ type: "hotcue", deck: "a", index: 3, down: true, shifted: false });
    expect(useDeckAStore.getState().hotCues).toEqual([
      { index: 3, positionSeconds: 42, label: null },
    ]);
  });
});
