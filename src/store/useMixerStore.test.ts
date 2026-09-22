import { beforeEach, describe, expect, it } from "vitest";
import { useMixerStore } from "./useMixerStore";

beforeEach(() => {
  useMixerStore.setState(useMixerStore.getInitialState(), true);
});

describe("useMixerStore", () => {
  it("starts with flat EQ, centered crossfader, and unity faders", () => {
    const state = useMixerStore.getState();
    expect(state.channels.a.eq).toEqual({ low: 0, mid: 0, high: 0 });
    expect(state.channels.a.volumeFader).toBe(1);
    expect(state.crossfaderPosition).toBe(0.5);
  });

  it("clamps EQ gain to [-24, 6] dB and only touches the targeted deck/band", () => {
    useMixerStore.getState().setEqGain("a", "low", 100);
    useMixerStore.getState().setEqGain("a", "mid", -100);

    const channelA = useMixerStore.getState().channels.a;
    expect(channelA.eq.low).toBe(6);
    expect(channelA.eq.mid).toBe(-24);
    expect(channelA.eq.high).toBe(0);
    expect(useMixerStore.getState().channels.b.eq.low).toBe(0);
  });

  it("kills and restores a band independently of its gain", () => {
    useMixerStore.getState().setEqGain("a", "low", 3);
    useMixerStore.getState().setEqKilled("a", "low", true);

    expect(useMixerStore.getState().channels.a.eqKilled.low).toBe(true);
    expect(useMixerStore.getState().channels.a.eq.low).toBe(3); // kill doesn't clobber the stored gain
  });

  it("clamps filter position to [-1, 1]", () => {
    useMixerStore.getState().setFilterPosition("b", 5);
    expect(useMixerStore.getState().channels.b.filterPosition).toBe(1);
    useMixerStore.getState().setFilterPosition("b", -5);
    expect(useMixerStore.getState().channels.b.filterPosition).toBe(-1);
  });

  it("clamps volume fader to [0, 1]", () => {
    useMixerStore.getState().setVolumeFader("a", 2);
    expect(useMixerStore.getState().channels.a.volumeFader).toBe(1);
    useMixerStore.getState().setVolumeFader("a", -1);
    expect(useMixerStore.getState().channels.a.volumeFader).toBe(0);
  });

  it("clamps crossfader position to [0, 1]", () => {
    useMixerStore.getState().setCrossfaderPosition(-1);
    expect(useMixerStore.getState().crossfaderPosition).toBe(0);
    useMixerStore.getState().setCrossfaderPosition(2);
    expect(useMixerStore.getState().crossfaderPosition).toBe(1);
  });

  it("resetChannel restores one deck's defaults without touching the other", () => {
    useMixerStore.getState().setEqGain("a", "low", 6);
    useMixerStore.getState().setVolumeFader("b", 0.3);

    useMixerStore.getState().resetChannel("a");

    expect(useMixerStore.getState().channels.a.eq.low).toBe(0);
    expect(useMixerStore.getState().channels.b.volumeFader).toBe(0.3);
  });
});
