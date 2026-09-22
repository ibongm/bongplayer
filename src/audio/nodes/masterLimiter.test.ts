import { describe, expect, it } from "vitest";
import { createMasterLimiter } from "./masterLimiter";
import { connectTestOscillator, peakAmplitude, renderMono } from "./testHelpers";

describe("createMasterLimiter", () => {
  it("compresses a full-scale signal so it does not grossly clip", async () => {
    const samples = await renderMono(0.2, (context) => {
      const limiter = createMasterLimiter(context);
      const source = context.createGain();
      source.gain.value = 4; // deliberately overdriven input, well above 0 dBFS
      connectTestOscillator(context, source);
      source.connect(limiter.input);
      limiter.output.connect(context.destination);
    });

    // A 20:1 ratio limiter can't be a perfect brickwall (non-zero attack),
    // but it must keep a 4x-overdriven input far below its raw amplitude.
    expect(peakAmplitude(samples)).toBeLessThan(2);
  });

  it("ducks output to ~20% amplitude under duckEmergency() and back under restoreEmergency()", async () => {
    // DynamicsCompressorNode has an intrinsic ~9ms lookahead delay (verified
    // empirically), so the "early" window must start after that settles.
    const samples = await renderMono(0.6, (context) => {
      const limiter = createMasterLimiter(context);
      const source = context.createGain();
      source.gain.value = 0.1; // well below threshold: compressor passes it through ~unchanged
      connectTestOscillator(context, source, 440, 0.6);
      source.connect(limiter.input);
      limiter.output.connect(context.destination);
      limiter.duckEmergency(0.25);
    });

    const earlyPeak = peakAmplitude(samples, Math.floor(0.012 * 44100), Math.floor(0.02 * 44100));
    const duckedPeak = peakAmplitude(samples, Math.floor(0.4 * 44100), Math.floor(0.5 * 44100));

    expect(earlyPeak).toBeCloseTo(0.1, 1);
    expect(duckedPeak).toBeCloseTo(0.1 * 0.2, 2);
  });
});
