import { describe, expect, it } from "vitest";
import { createDeckStore, type TrackMetadata } from "./createDeckStore";

const TRACK: TrackMetadata = {
  filePath: "C:/Music/track.mp3",
  title: "Track",
  artist: "Artist",
  duration: 200,
  bpm: null,
  key: null,
  sampleRate: 44100,
};

describe("createDeckStore", () => {
  it("stamps the deck id it was built with", () => {
    expect(createDeckStore("a").getState().deck).toBe("a");
    expect(createDeckStore("b").getState().deck).toBe("b");
  });

  it("starts empty and moves to stopped on loadTrack", () => {
    const store = createDeckStore("a");
    expect(store.getState().playbackState).toBe("empty");

    store.getState().loadTrack(TRACK);

    expect(store.getState().playbackState).toBe("stopped");
    expect(store.getState().track).toEqual(TRACK);
    expect(store.getState().currentTimeSeconds).toBe(0);
  });

  it("clearTrack resets to empty and drops hot cues", () => {
    const store = createDeckStore("a");
    store.getState().loadTrack(TRACK);
    store.getState().setHotCue(1, 10);

    store.getState().clearTrack();

    expect(store.getState().playbackState).toBe("empty");
    expect(store.getState().track).toBeNull();
    expect(store.getState().hotCues).toHaveLength(0);
  });

  it("ignores play/pause/stop when no track is loaded", () => {
    const store = createDeckStore("a");
    store.getState().play();
    expect(store.getState().playbackState).toBe("empty");
  });

  it("play/pause/stop transition playbackState once a track is loaded", () => {
    const store = createDeckStore("a");
    store.getState().loadTrack(TRACK);

    store.getState().play();
    expect(store.getState().playbackState).toBe("playing");

    store.getState().pause();
    expect(store.getState().playbackState).toBe("paused");

    store.getState().stop();
    expect(store.getState().playbackState).toBe("stopped");
    expect(store.getState().currentTimeSeconds).toBe(0);
  });

  it("clamps seek() to [0, track.duration]", () => {
    const store = createDeckStore("a");
    store.getState().loadTrack(TRACK);

    store.getState().seek(-10);
    expect(store.getState().currentTimeSeconds).toBe(0);

    store.getState().seek(9999);
    expect(store.getState().currentTimeSeconds).toBe(TRACK.duration);

    store.getState().seek(50);
    expect(store.getState().currentTimeSeconds).toBe(50);
  });

  it("tick() sets the playhead directly, for the rAF-driven audio node poll", () => {
    const store = createDeckStore("a");
    store.getState().tick(12.5);
    expect(store.getState().currentTimeSeconds).toBe(12.5);
  });

  it("clamps setPitchPercent() to the current pitch range and re-clamps when the range shrinks", () => {
    const store = createDeckStore("a");
    store.getState().setPitchRange(16);
    store.getState().setPitchPercent(20);
    expect(store.getState().pitchPercent).toBe(16);

    store.getState().setPitchPercent(-20);
    expect(store.getState().pitchPercent).toBe(-16);

    store.getState().setPitchPercent(10);
    store.getState().setPitchRange(8);
    expect(store.getState().pitchPercent).toBe(8);
  });

  it("toggles key lock", () => {
    const store = createDeckStore("a");
    expect(store.getState().keyLockEnabled).toBe(false);
    store.getState().toggleKeyLock();
    expect(store.getState().keyLockEnabled).toBe(true);
  });

  it("setHotCue replaces an existing cue at the same index rather than duplicating it", () => {
    const store = createDeckStore("a");
    store.getState().setHotCue(1, 5, "Intro");
    store.getState().setHotCue(1, 15, "Drop");

    const cues = store.getState().hotCues;
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ index: 1, positionSeconds: 15, label: "Drop" });
  });

  it("clearHotCue removes only the targeted index", () => {
    const store = createDeckStore("a");
    store.getState().setHotCue(1, 5);
    store.getState().setHotCue(2, 10);

    store.getState().clearHotCue(1);

    expect(store.getState().hotCues).toEqual([{ index: 2, positionSeconds: 10, label: null }]);
  });

  it("clearAllHotCues empties the list", () => {
    const store = createDeckStore("a");
    store.getState().setHotCue(1, 5);
    store.getState().setHotCue(2, 10);

    store.getState().clearAllHotCues();

    expect(store.getState().hotCues).toHaveLength(0);
  });
});
