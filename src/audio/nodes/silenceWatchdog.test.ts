import { describe, expect, it } from "vitest";
import { createSilenceDetector } from "./silenceWatchdog";

describe("createSilenceDetector", () => {
  it("does not trigger while level stays above threshold", () => {
    const detector = createSilenceDetector(-50, 3000);
    expect(detector.update(-10, 0)).toBe(false);
    expect(detector.update(-10, 5000)).toBe(false);
  });

  it("triggers exactly once the grace period has elapsed after silence begins", () => {
    const detector = createSilenceDetector(-50, 3000);
    expect(detector.update(-60, 0)).toBe(false); // silence begins at t=0
    expect(detector.update(-60, 2999)).toBe(false); // not yet
    expect(detector.update(-60, 3000)).toBe(true); // exactly at the grace boundary
  });

  it("resets the timer when level rises back above threshold before the grace period elapses", () => {
    const detector = createSilenceDetector(-50, 3000);
    detector.update(-60, 0); // silence starts at t=0
    detector.update(-10, 1000); // brief noise interrupts and resets the timer
    detector.update(-60, 1500); // silence resumes — a fresh timer starts at t=1500
    expect(detector.update(-60, 4000)).toBe(false); // only 2500ms since the second start
    expect(detector.update(-60, 4500)).toBe(true); // 3000ms since the second start (1500)
  });

  it("reset() clears any in-progress silence timer", () => {
    const detector = createSilenceDetector(-50, 3000);
    detector.update(-60, 0);
    detector.reset();
    expect(detector.update(-60, 3000)).toBe(false); // timer restarted from this call
  });

  it("treats a level exactly at the threshold as silent (only strictly-above counts as signal)", () => {
    const detector = createSilenceDetector(-50, 3000);
    expect(detector.update(-50, 0)).toBe(false);
    expect(detector.update(-50, 3000)).toBe(true);
  });
});
