import { describe, expect, it } from "vitest";
import { OfflineAudioContext } from "node-web-audio-api";
import { monoDownmix } from "./pcm";

describe("monoDownmix", () => {
  it("averages channels sample-by-sample", () => {
    const context = new OfflineAudioContext(2, 4, 44100);
    const buffer = context.createBuffer(2, 4, 44100);
    buffer.copyToChannel(new Float32Array([1, 1, 1, 1]), 0);
    buffer.copyToChannel(new Float32Array([-1, 0, 0.5, -0.5]), 1);

    const mono = monoDownmix(buffer);

    expect(Array.from(mono)).toEqual([0, 0.5, 0.75, 0.25]);
  });

  it("passes a mono buffer through unchanged", () => {
    const context = new OfflineAudioContext(1, 3, 44100);
    const buffer = context.createBuffer(1, 3, 44100);
    buffer.copyToChannel(new Float32Array([0.1, -0.2, 0.3]), 0);

    expect(Array.from(monoDownmix(buffer))).toEqual([
      Math.fround(0.1),
      Math.fround(-0.2),
      Math.fround(0.3),
    ]);
  });
});
