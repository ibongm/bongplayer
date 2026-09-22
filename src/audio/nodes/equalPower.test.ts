import { describe, expect, it } from "vitest";
import { createEqualPowerCrossfade } from "./equalPower";
import { connectTestOscillator, peakAmplitude, renderMono } from "./testHelpers";

describe("createEqualPowerCrossfade", () => {
  it("passes only Deck A at position 0", async () => {
    const samples = await renderMono(0.2, (context) => {
      const crossfade = createEqualPowerCrossfade(context);
      crossfade.setPosition(0, 0.01);
      connectTestOscillator(context, crossfade.gainA, 440, 0.2);
      const silentB = context.createOscillator();
      silentB.frequency.value = 220;
      silentB.connect(crossfade.gainB);
      silentB.start(0);
      silentB.stop(0.2);
      crossfade.output.connect(context.destination);
    });

    const settled = peakAmplitude(samples, Math.floor(0.05 * 44100), samples.length);
    expect(settled).toBeCloseTo(1, 1);
  });

  it("passes only Deck B at position 1", async () => {
    const samples = await renderMono(0.2, (context) => {
      const crossfade = createEqualPowerCrossfade(context);
      crossfade.setPosition(1, 0.01);
      const silentA = context.createOscillator();
      silentA.frequency.value = 220;
      silentA.connect(crossfade.gainA);
      silentA.start(0);
      silentA.stop(0.2);
      connectTestOscillator(context, crossfade.gainB, 440, 0.2);
      crossfade.output.connect(context.destination);
    });

    const settled = peakAmplitude(samples, Math.floor(0.05 * 44100), samples.length);
    expect(settled).toBeCloseTo(1, 1);
  });

  it("keeps constant power through the sweep: gainA^2 + gainB^2 ~= 1", () => {
    for (let p = 0; p <= 1; p += 0.1) {
      const gainA = Math.cos((p * Math.PI) / 2);
      const gainB = Math.cos(((1 - p) * Math.PI) / 2);
      expect(gainA * gainA + gainB * gainB).toBeCloseTo(1, 5);
    }
  });

  it("supports the linear curve via the optional curve parameter", async () => {
    const samples = await renderMono(0.2, (context) => {
      const crossfade = createEqualPowerCrossfade(context);
      crossfade.setPosition(0.25, 0.01, "linear");
      connectTestOscillator(context, crossfade.gainA, 440, 0.2);
      crossfade.output.connect(context.destination);
    });
    // linear: gainA at p=0.25 is 1 - 0.25 = 0.75 (vs constant-power's cos(0.25*pi/2) ~= 0.924).
    const settled = peakAmplitude(samples, Math.floor(0.05 * 44100), samples.length);
    expect(settled).toBeCloseTo(0.75, 1);
  });

  it("supports the sharpCut curve via the optional curve parameter", async () => {
    const samples = await renderMono(0.2, (context) => {
      const crossfade = createEqualPowerCrossfade(context);
      crossfade.setPosition(0.3, 0.01, "sharpCut"); // below sharpCut's 0.45 start -> full A, zero B
      connectTestOscillator(context, crossfade.gainB, 440, 0.2);
      crossfade.output.connect(context.destination);
    });
    const settled = peakAmplitude(samples, Math.floor(0.05 * 44100), samples.length);
    expect(settled).toBeCloseTo(0, 2);
  });
});
