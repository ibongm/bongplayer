import { describe, expect, it } from "vitest";
import { OfflineAudioContext } from "node-web-audio-api";
import { decodeAndExtractPeaks, extractPeaks } from "./waveform";
import { makeTestWav } from "./testWavFixture";

describe("extractPeaks", () => {
  it("computes exact min/max per pixel for a known signal", () => {
    const context = new OfflineAudioContext(1, 8, 44100);
    const buffer = context.createBuffer(1, 8, 44100);
    buffer.copyToChannel(new Float32Array([0, 1, -1, 0.5, 0, -0.5, 1, -1]), 0);

    const { peaks, duration } = extractPeaks(buffer, 4);

    expect(Array.from(peaks)).toEqual([0, 1, -1, 0.5, -0.5, 0, -1, 1]);
    expect(duration).toBeCloseTo(8 / 44100, 6);
  });

  it("summarizes across all channels (mono overview)", () => {
    const context = new OfflineAudioContext(2, 4, 44100);
    const buffer = context.createBuffer(2, 4, 44100);
    buffer.copyToChannel(new Float32Array([0, 0.2, 0, 0.2]), 0);
    buffer.copyToChannel(new Float32Array([0, -0.9, 0, -0.9]), 1);

    const { peaks } = extractPeaks(buffer, 1);

    expect(peaks[0]).toBeCloseTo(-0.9, 6); // min across both channels
    expect(peaks[1]).toBeCloseTo(0.2, 6); // max across both channels
  });

  it("clamps outputWidth to at least 1 pixel", () => {
    const context = new OfflineAudioContext(1, 4, 44100);
    const buffer = context.createBuffer(1, 4, 44100);
    const { peaks } = extractPeaks(buffer, 0);
    expect(peaks.length).toBe(2);
  });
});

describe("decodeAndExtractPeaks", () => {
  it("decodes a real WAV and extracts peaks matching its content", async () => {
    const sampleRate = 8000;
    const samples: number[] = [];
    for (let i = 0; i < sampleRate * 0.05; i++) {
      samples.push(Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }
    const wavBytes = makeTestWav(samples, sampleRate);
    const context = new OfflineAudioContext(1, 1, 44100);

    const { peaks, duration } = await decodeAndExtractPeaks(wavBytes, 10, context);

    expect(duration).toBeCloseTo(0.05, 2);
    expect(peaks.length).toBe(20);
    // A 440 Hz sine should swing close to full scale somewhere in the buffer.
    expect(Math.max(...Array.from(peaks))).toBeGreaterThan(0.8);
    expect(Math.min(...Array.from(peaks))).toBeLessThan(-0.8);
  });
});
