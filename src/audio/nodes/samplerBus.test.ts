import { describe, expect, it } from "vitest";
import { createSamplerBus } from "./samplerBus";
import { connectTestOscillator, peakAmplitude, renderMono } from "./testHelpers";
import { dbToGain } from "../utils";

describe("createSamplerBus", () => {
  it("creates 8 independent voices summed into one output", async () => {
    const samples = await renderMono(0.2, (context) => {
      const bus = createSamplerBus(context);
      expect(bus.voices).toHaveLength(8);
      connectTestOscillator(context, bus.voices[3].input);
      bus.output.connect(context.destination);
    });

    expect(peakAmplitude(samples)).toBeCloseTo(1, 2);
  });

  it("ramps a single voice's gain via setGain without affecting others", async () => {
    const samples = await renderMono(0.3, (context) => {
      const bus = createSamplerBus(context);
      connectTestOscillator(context, bus.voices[0].input, 440, 0.3);
      bus.voices[0].setGain(-6, 0.01);
      bus.output.connect(context.destination);
    });

    const tailPeak = peakAmplitude(samples, Math.floor(0.1 * 44100), samples.length);
    expect(tailPeak).toBeCloseTo(dbToGain(-6), 2);
  });
});
