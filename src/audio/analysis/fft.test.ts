import { describe, expect, it } from "vitest";
import { fft, nextPowerOfTwo } from "./fft";

describe("fft", () => {
  it("shows a single spike at the correct bin for a pure sinusoid", () => {
    const n = 64;
    const targetBin = 5;
    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      real[i] = Math.cos((2 * Math.PI * targetBin * i) / n);
    }

    fft(real, imag);

    const magnitudes = Array.from({ length: n }, (_, i) => Math.hypot(real[i], imag[i]));
    const peakBin = magnitudes.indexOf(Math.max(...magnitudes));

    // A real cosine produces energy at both +bin and n-bin (its mirror); the peak should be one of them.
    expect([targetBin, n - targetBin]).toContain(peakBin);
    // Energy should be concentrated: bins far from the spike should be near zero.
    expect(magnitudes[targetBin + 10]).toBeLessThan(magnitudes[peakBin] * 0.05);
  });

  it("produces zero output for all-zero input", () => {
    const n = 16;
    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    fft(real, imag);
    expect(Array.from(real).every((v) => v === 0)).toBe(true);
    expect(Array.from(imag).every((v) => v === 0)).toBe(true);
  });
});

describe("nextPowerOfTwo", () => {
  it("returns the input unchanged when it's already a power of 2", () => {
    expect(nextPowerOfTwo(64)).toBe(64);
    expect(nextPowerOfTwo(1)).toBe(1);
  });

  it("rounds up to the next power of 2", () => {
    expect(nextPowerOfTwo(65)).toBe(128);
    expect(nextPowerOfTwo(1000)).toBe(1024);
  });
});
