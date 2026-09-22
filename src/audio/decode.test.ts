import { describe, expect, it } from "vitest";
import { OfflineAudioContext } from "node-web-audio-api";
import { decodeAudioFile, decodeViaBrowser } from "./decode";
import { makeTestWav } from "./testWavFixture";

describe("decodeViaBrowser", () => {
  it("decodes a real WAV buffer into an AudioBuffer", async () => {
    const sampleRate = 8000;
    const samples = [0, 0.5, -0.5, 1, -1];
    const wavBytes = makeTestWav(samples, sampleRate);
    const context = new OfflineAudioContext(1, 1, 44100);

    const decoded = await decodeViaBrowser(wavBytes, context);

    expect(decoded.duration).toBeGreaterThan(0);
    expect(decoded.sampleRate).toBe(44100); // decodeAudioData resamples to the context's rate
    expect(decoded.audioBuffer.numberOfChannels).toBe(1);
  });
});

describe("decodeAudioFile", () => {
  it("uses the browser decode path directly when it succeeds", async () => {
    const wavBytes = makeTestWav([0, 1, -1, 0.5], 8000);
    const context = new OfflineAudioContext(1, 1, 44100);

    const decoded = await decodeAudioFile(wavBytes, context);

    expect(decoded.audioBuffer.numberOfChannels).toBe(1);
    expect(decoded.duration).toBeGreaterThan(0);
  });

  it("surfaces both failures when browser decode fails and no Tauri IPC bridge is present", async () => {
    const garbageBytes = new ArrayBuffer(16);
    const context = new OfflineAudioContext(1, 1, 44100);

    await expect(decodeAudioFile(garbageBytes, context)).rejects.toThrow(
      /browser decode:.*Rust fallback:/s,
    );
  });
});
