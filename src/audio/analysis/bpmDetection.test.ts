import { describe, expect, it } from "vitest";
import { computeOnsetEnvelope, detectBpm, detectBpmFromOnsetEnvelope } from "./bpmDetection";

describe("detectBpmFromOnsetEnvelope", () => {
  it("recovers the exact BPM from a synthetic envelope with periodic spikes", () => {
    const envelopeFrameRate = 43; // ~44100/1024, a realistic value
    const lagFrames = 20; // exact integer lag the detector should find
    const envelope = new Float32Array(400);
    for (let i = 0; i < envelope.length; i += lagFrames) {
      envelope[i] = 1;
    }

    const bpm = detectBpmFromOnsetEnvelope(envelope, envelopeFrameRate, 60, 180);
    const expectedBpm = (60 * envelopeFrameRate) / lagFrames;

    expect(bpm).toBeCloseTo(expectedBpm, 6);
  });

  it("returns 0 when the envelope is too short for the search range", () => {
    const bpm = detectBpmFromOnsetEnvelope(new Float32Array(2), 43, 60, 180);
    expect(bpm).toBe(0);
  });
});

describe("computeOnsetEnvelope", () => {
  it("is zero for silence", () => {
    const envelope = computeOnsetEnvelope(new Float32Array(4096), 1024);
    expect(Array.from(envelope).every((v) => v === 0)).toBe(true);
  });

  it("spikes only where energy increases, not where it decreases", () => {
    const frameSize = 4;
    // Frame energies: quiet, loud, quiet, loud
    const samples = new Float32Array([
      0,
      0,
      0,
      0, // frame 0: silent
      1,
      1,
      1,
      1, // frame 1: loud (increase from frame 0)
      0,
      0,
      0,
      0, // frame 2: silent (decrease from frame 1)
      1,
      1,
      1,
      1, // frame 3: loud (increase from frame 2)
    ]);
    const envelope = computeOnsetEnvelope(samples, frameSize);
    expect(envelope[0]).toBe(0); // no prior frame to compare
    expect(envelope[1]).toBeGreaterThan(0); // increase
    expect(envelope[2]).toBe(0); // decrease -> rectified to 0
    expect(envelope[3]).toBeGreaterThan(0); // increase
  });
});

describe("detectBpm", () => {
  it("detects the BPM of a synthetic periodic burst track", () => {
    const sampleRate = 44100;
    const frameSize = 1024;
    const lagFrames = 20;
    const beatIntervalSamples = lagFrames * frameSize;
    const totalBeats = 15;
    const samples = new Float32Array(beatIntervalSamples * totalBeats);

    const burstLength = 800;
    for (let beat = 0; beat < totalBeats; beat++) {
      const start = beat * beatIntervalSamples;
      for (let i = 0; i < burstLength; i++) {
        samples[start + i] = Math.sin((2 * Math.PI * 200 * i) / sampleRate);
      }
    }

    const bpm = detectBpm(samples, sampleRate, frameSize);
    const expectedBpm = (60 * sampleRate) / beatIntervalSamples;

    expect(bpm).toBeCloseTo(expectedBpm, 0);
  });
});
