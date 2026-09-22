import { describe, expect, it } from "vitest";
import { createThreeBandEQ } from "./threeBandEQ";
import { connectTestOscillator, peakAmplitude, renderMono } from "./testHelpers";
import { dbToGain } from "../utils";

describe("createThreeBandEQ", () => {
  it("passes a mid-band tone at ~unity when all bands are flat", async () => {
    const samples = await renderMono(0.2, (context) => {
      const eq = createThreeBandEQ(context);
      connectTestOscillator(context, eq.input, 1000);
      eq.output.connect(context.destination);
    });

    expect(peakAmplitude(samples)).toBeCloseTo(1, 1);
  });

  it("boosts a low-frequency tone by ~+6 dB when the low band is boosted", async () => {
    const flat = await renderMono(0.2, (context) => {
      const eq = createThreeBandEQ(context);
      connectTestOscillator(context, eq.input, 100);
      eq.output.connect(context.destination);
    });

    const boosted = await renderMono(0.2, (context) => {
      const eq = createThreeBandEQ(context);
      eq.low.setGainDb(6, 0);
      connectTestOscillator(context, eq.input, 100);
      eq.output.connect(context.destination);
    });

    const ratio = peakAmplitude(boosted) / peakAmplitude(flat);
    expect(ratio).toBeCloseTo(dbToGain(6), 0);
  });

  it("kills only the targeted band, leaving the others' frequency content intact", async () => {
    const durationSeconds = 0.3;
    const killRampSeconds = 0.02;
    const settleIndex = Math.floor((killRampSeconds + 0.05) * 44100);

    const lowSamples = await renderMono(durationSeconds, (context) => {
      const eq = createThreeBandEQ(context);
      eq.low.setKilled(true, killRampSeconds);
      connectTestOscillator(context, eq.input, 100, durationSeconds);
      eq.output.connect(context.destination);
    });

    const highSamples = await renderMono(durationSeconds, (context) => {
      const eq = createThreeBandEQ(context);
      eq.low.setKilled(true, killRampSeconds);
      connectTestOscillator(context, eq.input, 12000, durationSeconds);
      eq.output.connect(context.destination);
    });

    // Low band killed: a 100 Hz tone (deep in the low-shelf's band) is
    // heavily attenuated once the kill ramp settles...
    expect(peakAmplitude(lowSamples, settleIndex, lowSamples.length)).toBeLessThan(0.01);
    // ...but a 12 kHz tone (outside the low band entirely) passes through
    // the mid/high bands essentially unaffected — proving kill doesn't mute
    // the whole series chain.
    expect(peakAmplitude(highSamples, settleIndex, highSamples.length)).toBeCloseTo(1, 1);
  });
});
