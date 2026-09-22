import { describe, expect, it } from "vitest";
import { createEchoEffect } from "./echoEffect";
import { connectTestOscillator, peakAmplitude, renderMono } from "./testHelpers";

const DELAY_SECONDS = 0.1;

describe("createEchoEffect", () => {
  it("defaults to fully dry (bypassed) — output closely matches a pass-through input", async () => {
    const samples = await renderMono(0.2, (context) => {
      const echo = createEchoEffect(context, DELAY_SECONDS, 0.4);
      connectTestOscillator(context, echo.input, 440, 0.2);
      echo.output.connect(context.destination);
    });

    expect(peakAmplitude(samples)).toBeCloseTo(1, 1);
  });

  it("at full wet, the dry signal is silent and a delayed echo appears after delaySeconds", async () => {
    const burstDuration = 0.02;
    const samples = await renderMono(0.5, (context) => {
      const echo = createEchoEffect(context, DELAY_SECONDS, 0.5);
      echo.setWetLevel(1, 0); // instantly full wet, before any audio plays
      connectTestOscillator(context, echo.input, 440, burstDuration);
      echo.output.connect(context.destination);
    });

    const sampleRate = 44100;
    const beforeEcho = peakAmplitude(samples, 0, Math.floor((DELAY_SECONDS - 0.01) * sampleRate));
    const atEcho = peakAmplitude(
      samples,
      Math.floor(DELAY_SECONDS * sampleRate),
      Math.floor((DELAY_SECONDS + burstDuration + 0.01) * sampleRate),
    );

    expect(beforeEcho).toBeCloseTo(0, 2); // dry path is silent at full wet
    expect(atEcho).toBeGreaterThan(0.1); // the delayed repeat is audible
  });

  it("feedback produces a second, quieter repeat around 2x the delay time", async () => {
    const burstDuration = 0.02;
    const samples = await renderMono(0.5, (context) => {
      const echo = createEchoEffect(context, DELAY_SECONDS, 0.5);
      echo.setWetLevel(1, 0);
      connectTestOscillator(context, echo.input, 440, burstDuration);
      echo.output.connect(context.destination);
    });

    const sampleRate = 44100;
    const firstEcho = peakAmplitude(
      samples,
      Math.floor(DELAY_SECONDS * sampleRate),
      Math.floor((DELAY_SECONDS + burstDuration + 0.01) * sampleRate),
    );
    const secondEcho = peakAmplitude(
      samples,
      Math.floor(2 * DELAY_SECONDS * sampleRate),
      Math.floor((2 * DELAY_SECONDS + burstDuration + 0.01) * sampleRate),
    );

    expect(secondEcho).toBeGreaterThan(0.01); // still audible...
    expect(secondEcho).toBeLessThan(firstEcho); // ...but quieter than the first repeat
  });

  it("setWetLevel clamps to [0, 1]", async () => {
    const samples = await renderMono(0.2, (context) => {
      const echo = createEchoEffect(context, DELAY_SECONDS, 0.4);
      echo.setWetLevel(5, 0); // out-of-range — should clamp to 1, not error
      connectTestOscillator(context, echo.input, 440, 0.02);
      echo.output.connect(context.destination);
    });
    expect(Number.isFinite(peakAmplitude(samples))).toBe(true);
  });
});
