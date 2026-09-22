import { describe, expect, it } from "vitest";
import { createMusicBus } from "./musicBus";
import { connectTestOscillator, peakAmplitude, renderMono, SAMPLE_RATE } from "./testHelpers";
import { dbToGain } from "../utils";

describe("createMusicBus", () => {
  it("applies the -9 dB baseline gain stage", async () => {
    const samples = await renderMono(0.2, (context) => {
      const bus = createMusicBus(context);
      connectTestOscillator(context, bus.input);
      bus.output.connect(context.destination);
    });

    const peak = peakAmplitude(samples);
    expect(peak).toBeCloseTo(dbToGain(-9), 2);
  });

  it("ramps down under duck() and back up under restore()", async () => {
    const duckedAtDb = -9 - 12;
    const samples = await renderMono(0.6, (context) => {
      const bus = createMusicBus(context);
      connectTestOscillator(context, bus.input, 440, 0.6);
      bus.output.connect(context.destination);
      bus.duck(12, 0.05);
    });

    const earlyPeak = peakAmplitude(samples, 0, Math.floor(0.005 * SAMPLE_RATE));
    const duckedPeak = peakAmplitude(
      samples,
      Math.floor(0.2 * SAMPLE_RATE),
      Math.floor(0.3 * SAMPLE_RATE),
    );

    expect(earlyPeak).toBeCloseTo(dbToGain(-9), 2);
    expect(duckedPeak).toBeCloseTo(dbToGain(duckedAtDb), 2);
  });
});
