import { describe, expect, it } from "vitest";
import {
  computeChromaForFrame,
  detectKeyFromChroma,
  extractChromaProfile,
  toCamelotNotation,
  type DetectedKey,
} from "./keyDetection";

describe("detectKeyFromChroma", () => {
  it("recovers C major exactly from the C-major Krumhansl-Kessler profile itself", () => {
    // The reference profile is defined starting at C (index 0), so feeding
    // it back in unrotated should match tonic=C, mode=major perfectly.
    const cMajorProfile = new Float64Array([
      6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ]);
    const key = detectKeyFromChroma(cMajorProfile);
    expect(key.tonicPitchClass).toBe(0);
    expect(key.mode).toBe("major");
    expect(key.correlation).toBeCloseTo(1, 6);
  });

  it("recovers a rotated tonic (G major, pitch class 7)", () => {
    const cMajorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    // Rotating the reference profile by G's pitch class (7) up should be
    // recognized as G major: profile[i] belongs at pitch class (i + 7) % 12.
    const gMajorChroma = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      gMajorChroma[(i + 7) % 12] = cMajorProfile[i];
    }
    const key = detectKeyFromChroma(gMajorChroma);
    expect(key.tonicPitchClass).toBe(7);
    expect(key.mode).toBe("major");
  });

  it("recovers A minor from the A-minor Krumhansl-Kessler profile", () => {
    const aMinorProfile = new Float64Array(12);
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    for (let i = 0; i < 12; i++) {
      aMinorProfile[(i + 9) % 12] = minorProfile[i]; // A = pitch class 9
    }
    const key = detectKeyFromChroma(aMinorProfile);
    expect(key.tonicPitchClass).toBe(9);
    expect(key.mode).toBe("minor");
  });
});

describe("toCamelotNotation", () => {
  function key(tonicPitchClass: number, mode: "major" | "minor"): DetectedKey {
    return { tonicPitchClass, mode, correlation: 1 };
  }

  it("matches known relative major/minor pairs (same Camelot number, A/B suffix)", () => {
    // C major <-> A minor
    expect(toCamelotNotation(key(0, "major"))).toBe("8B");
    expect(toCamelotNotation(key(9, "minor"))).toBe("8A");
    // G major <-> E minor
    expect(toCamelotNotation(key(7, "major"))).toBe("9B");
    expect(toCamelotNotation(key(4, "minor"))).toBe("9A");
    // D major <-> B minor
    expect(toCamelotNotation(key(2, "major"))).toBe("10B");
    expect(toCamelotNotation(key(11, "minor"))).toBe("10A");
  });

  it("follows the circle of fifths around the wheel (each step +1, wrapping 12->1)", () => {
    const circleOfFifthsMajorPitchClasses = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C G D A E B F# C# Ab Eb Bb F
    const expectedCamelotNumbers = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];
    circleOfFifthsMajorPitchClasses.forEach((pitchClass, i) => {
      expect(toCamelotNotation(key(pitchClass, "major"))).toBe(`${expectedCamelotNumbers[i]}B`);
    });
  });
});

describe("computeChromaForFrame", () => {
  it("places a pure tone's energy in its correct pitch class", () => {
    const sampleRate = 44100;
    const fftSize = 4096;
    // Bin whose frequency is close to A4 (440 Hz, pitch class 9).
    const targetBin = Math.round((440 * fftSize) / sampleRate);
    const magnitudes = new Float64Array(fftSize);
    magnitudes[targetBin] = 1;
    magnitudes[fftSize - targetBin] = 1; // mirror bin, as a real FFT would also show

    const chroma = computeChromaForFrame(magnitudes, sampleRate, fftSize);
    const maxIndex = chroma.indexOf(Math.max(...Array.from(chroma)));

    expect(maxIndex).toBe(9); // A
  });
});

describe("extractChromaProfile", () => {
  it("returns an all-zero profile for a signal shorter than one FFT frame", () => {
    const chroma = extractChromaProfile(new Float32Array(10), 44100, 4096);
    expect(Array.from(chroma).every((v) => v === 0)).toBe(true);
  });
});
