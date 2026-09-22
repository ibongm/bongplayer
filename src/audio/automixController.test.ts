import { describe, expect, it } from "vitest";
import {
  bassSwapKillState,
  crossfaderPositionForTransition,
  shouldStartTransition,
} from "./automixController";

describe("shouldStartTransition", () => {
  it("is false while well before the trigger window", () => {
    expect(shouldStartTransition(10, 180, 15)).toBe(false);
  });

  it("is true once inside the trigger window", () => {
    expect(shouldStartTransition(170, 180, 15)).toBe(true);
  });

  it("is true exactly at the trigger boundary", () => {
    expect(shouldStartTransition(165, 180, 15)).toBe(true);
  });

  it("is false for a track with no known duration yet", () => {
    expect(shouldStartTransition(5, 0, 15)).toBe(false);
  });
});

describe("crossfaderPositionForTransition", () => {
  it("smooth: interpolates linearly from fromDeck=a toward full B", () => {
    expect(crossfaderPositionForTransition("a", "smooth", 0)).toBe(0);
    expect(crossfaderPositionForTransition("a", "smooth", 0.5)).toBeCloseTo(0.5);
    expect(crossfaderPositionForTransition("a", "smooth", 1)).toBe(1);
  });

  it("smooth: interpolates the opposite direction from fromDeck=b", () => {
    expect(crossfaderPositionForTransition("b", "smooth", 0)).toBe(1);
    expect(crossfaderPositionForTransition("b", "smooth", 0.5)).toBeCloseTo(0.5);
    expect(crossfaderPositionForTransition("b", "smooth", 1)).toBe(0);
  });

  it("cut: jumps immediately once progress is past zero, regardless of amount", () => {
    expect(crossfaderPositionForTransition("a", "cut", 0)).toBe(0);
    expect(crossfaderPositionForTransition("a", "cut", 0.01)).toBe(1);
    expect(crossfaderPositionForTransition("a", "cut", 0.99)).toBe(1);
  });

  it("bassSwap and echoOut follow the same linear curve as smooth", () => {
    expect(crossfaderPositionForTransition("a", "bassSwap", 0.3)).toBeCloseTo(0.3);
    expect(crossfaderPositionForTransition("a", "echoOut", 0.3)).toBeCloseTo(0.3);
  });

  it("clamps out-of-range progress", () => {
    expect(crossfaderPositionForTransition("a", "smooth", -1)).toBe(0);
    expect(crossfaderPositionForTransition("a", "smooth", 2)).toBe(1);
  });
});

describe("bassSwapKillState", () => {
  it("kills the incoming deck's bass before the midpoint", () => {
    expect(bassSwapKillState(0.2)).toEqual({ outgoingLowKilled: false, incomingLowKilled: true });
  });

  it("swaps to killing the outgoing deck's bass at and after the midpoint", () => {
    expect(bassSwapKillState(0.5)).toEqual({ outgoingLowKilled: true, incomingLowKilled: false });
    expect(bassSwapKillState(0.9)).toEqual({ outgoingLowKilled: true, incomingLowKilled: false });
  });
});
