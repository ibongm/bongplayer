import { beforeEach, describe, expect, it } from "vitest";
import { createDeckEngine } from "./deckEngine";
import { getAudioContext } from "./context";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeBuffer(durationSeconds: number): AudioBuffer {
  const context = getAudioContext();
  return context.createBuffer(
    1,
    Math.round(durationSeconds * context.sampleRate),
    context.sampleRate,
  );
}

// Real-time wall-clock tests (globalThis.AudioContext is polyfilled with a
// genuine real-time implementation in src/testSetup.ts) — generous
// tolerances since these depend on actual elapsed time, not simulated time.
describe("createDeckEngine", () => {
  beforeEach(() => {
    // Each test gets a fresh engine (deck id doesn't matter for these
    // assertions), but they all share the one process-wide AudioContext
    // singleton — consistent with how the app itself works.
  });

  it("starts at position 0 and stays there until played", () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    expect(engine.getCurrentTime()).toBe(0);
    expect(engine.isPlaying()).toBe(false);
    engine.dispose();
  });

  it("advances getCurrentTime() at roughly wall-clock speed while playing", async () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.play();
    expect(engine.isPlaying()).toBe(true);

    await wait(150);

    const elapsed = engine.getCurrentTime();
    expect(elapsed).toBeGreaterThan(0.08);
    expect(elapsed).toBeLessThan(0.4);
    engine.dispose();
  });

  it("pause() freezes the position", async () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.play();
    await wait(100);
    engine.pause();
    const pausedAt = engine.getCurrentTime();
    expect(engine.isPlaying()).toBe(false);

    await wait(100);
    expect(engine.getCurrentTime()).toBeCloseTo(pausedAt, 2);
    engine.dispose();
  });

  it("seek() while paused sets the position without starting playback", () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.seek(2.5);
    expect(engine.getCurrentTime()).toBeCloseTo(2.5, 6);
    expect(engine.isPlaying()).toBe(false);
    engine.dispose();
  });

  it("seek() while playing jumps position and keeps advancing from there", async () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.play();
    engine.seek(3);
    await wait(100);
    expect(engine.getCurrentTime()).toBeGreaterThan(3.05);
    expect(engine.getCurrentTime()).toBeLessThan(3.4);
    engine.dispose();
  });

  it("stop() resets position to 0 and stops playback", async () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.play();
    await wait(50);
    engine.stop();
    expect(engine.getCurrentTime()).toBe(0);
    expect(engine.isPlaying()).toBe(false);
    engine.dispose();
  });

  it("setPlaybackRate() changes how fast track-time advances relative to wall-clock time", async () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.setPlaybackRate(2);
    engine.play();
    await wait(150);
    // At 2x speed, ~150ms of wall-clock time should advance track-time ~300ms.
    const elapsed = engine.getCurrentTime();
    expect(elapsed).toBeGreaterThan(0.18);
    expect(elapsed).toBeLessThan(0.6);
    engine.dispose();
  });

  it("loadBuffer() resets position and stops any prior playback", async () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.play();
    await wait(50);
    engine.loadBuffer(makeBuffer(3));
    expect(engine.getCurrentTime()).toBe(0);
    expect(engine.isPlaying()).toBe(false);
    engine.dispose();
  });

  it("clamps seek() to [0, buffer.duration]", () => {
    const engine = createDeckEngine("a");
    engine.loadBuffer(makeBuffer(5));
    engine.seek(-10);
    expect(engine.getCurrentTime()).toBe(0);
    engine.seek(999);
    expect(engine.getCurrentTime()).toBeCloseTo(5, 6);
    engine.dispose();
  });

  it("getBuffer() returns the currently loaded buffer, or null before any load", () => {
    const engine = createDeckEngine("a");
    expect(engine.getBuffer()).toBeNull();
    const buffer = makeBuffer(5);
    engine.loadBuffer(buffer);
    expect(engine.getBuffer()).toBe(buffer);
    engine.dispose();
  });
});
