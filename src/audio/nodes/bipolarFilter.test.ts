import { describe, expect, it } from "vitest";
import { createBipolarFilter } from "./bipolarFilter";
import { connectTestOscillator, peakAmplitude, renderMono } from "./testHelpers";

describe("createBipolarFilter", () => {
  it("passes a mid-frequency tone essentially unattenuated at center position", async () => {
    const samples = await renderMono(0.2, (context) => {
      const filter = createBipolarFilter(context);
      connectTestOscillator(context, filter.node, 1000);
      filter.node.connect(context.destination);
    });

    expect(peakAmplitude(samples)).toBeCloseTo(1, 1);
  });

  it("attenuates a low-frequency tone when swept toward highpass (position < 0)", async () => {
    const durationSeconds = 0.3;
    const settleIndex = Math.floor(0.1 * 44100);

    const samples = await renderMono(durationSeconds, (context) => {
      const filter = createBipolarFilter(context);
      filter.setPosition(-1, 0.02);
      connectTestOscillator(context, filter.node, 80, durationSeconds);
      filter.node.connect(context.destination);
    });

    expect(peakAmplitude(samples, settleIndex, samples.length)).toBeLessThan(0.2);
  });

  it("attenuates a high-frequency tone when swept toward lowpass (position > 0)", async () => {
    const durationSeconds = 0.3;
    const settleIndex = Math.floor(0.1 * 44100);

    const samples = await renderMono(durationSeconds, (context) => {
      const filter = createBipolarFilter(context);
      filter.setPosition(1, 0.02);
      connectTestOscillator(context, filter.node, 15000, durationSeconds);
      filter.node.connect(context.destination);
    });

    expect(peakAmplitude(samples, settleIndex, samples.length)).toBeLessThan(0.2);
  });
});
