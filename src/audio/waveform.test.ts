import { describe, expect, it } from "vitest";
import { OfflineAudioContext } from "node-web-audio-api";
import { decodeAndExtractPeaks, extractPeaks, windowPeaks } from "./waveform";
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

describe("windowPeaks", () => {
  const PIXEL_COUNT = 100;
  const FULL_DURATION = 100; // 1 second per pixel, for easy-to-verify math

  function makeTraceablePeaks(): Float32Array {
    // peaks[i] = i, so the slice's first value directly reveals which pixel it started at.
    const peaks = new Float32Array(PIXEL_COUNT * 2);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      peaks[i * 2] = i;
      peaks[i * 2 + 1] = i;
    }
    return peaks;
  }

  it("centers the playhead in the middle of a track", () => {
    const result = windowPeaks(makeTraceablePeaks(), FULL_DURATION, 50, 10);
    expect(result.playheadInWindowSeconds).toBeCloseTo(5, 6);
    expect(result.peaks[0]).toBe(45); // window starts at t=45s
  });

  it("de-centers the playhead near the start rather than padding with fake silence", () => {
    const result = windowPeaks(makeTraceablePeaks(), FULL_DURATION, 2, 10);
    expect(result.peaks[0]).toBe(0); // the window can't start before t=0
    expect(result.playheadInWindowSeconds).toBeCloseTo(2, 6);
  });

  it("de-centers the playhead near the end", () => {
    const result = windowPeaks(makeTraceablePeaks(), FULL_DURATION, 98, 10);
    expect(result.playheadInWindowSeconds).toBeCloseTo(8, 6);
  });

  it("doesn't clamp the playhead when the track is shorter than the window (shows the whole track)", () => {
    const shortPeaks = makeTraceablePeaks().slice(0, 10); // 5 pixels = 5 seconds
    const result = windowPeaks(shortPeaks, 5, 3, 10);
    expect(result.playheadInWindowSeconds).toBeCloseTo(3, 6);
  });

  it("returns an empty window for zero-length input without throwing", () => {
    expect(windowPeaks(new Float32Array(0), 0, 0, 10).peaks.length).toBe(0);
  });
});
