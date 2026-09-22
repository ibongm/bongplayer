/**
 * Camelot key detection (AGENTS §3, workers/audioAnalysis.worker.ts):
 * FFT -> chroma (12-pitch-class) profile -> Krumhansl-Schmuckler key-finding
 * (correlate against the 24 major/minor key profiles) -> Camelot notation.
 */

import { fft, nextPowerOfTwo } from "./fft";

const C4_FREQ = 261.6255653005986;
const MIN_ANALYSIS_FREQ_HZ = 80;
const MAX_ANALYSIS_FREQ_HZ = 5000;
const DEFAULT_FFT_SIZE = 4096;
const DEFAULT_MAX_FRAMES = 40;

// Krumhansl-Kessler key profiles (published constants), indexed C, C#, D, ... B.
const MAJOR_PROFILE: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// Camelot wheel, indexed by pitch class (0=C .. 11=B). See CHANGELOG.md for
// the circle-of-fifths derivation this table was checked against.
const MAJOR_CAMELOT: readonly string[] = [
  "8B",
  "3B",
  "10B",
  "5B",
  "12B",
  "7B",
  "2B",
  "9B",
  "4B",
  "11B",
  "6B",
  "1B",
];
const MINOR_CAMELOT: readonly string[] = [
  "5A",
  "12A",
  "7A",
  "2A",
  "9A",
  "4A",
  "11A",
  "6A",
  "1A",
  "8A",
  "3A",
  "10A",
];

export type KeyMode = "major" | "minor";

export interface DetectedKey {
  readonly tonicPitchClass: number;
  readonly mode: KeyMode;
  readonly correlation: number;
}

function frequencyToPitchClass(freq: number): number {
  const semitonesFromC4 = 12 * Math.log2(freq / C4_FREQ);
  return ((Math.round(semitonesFromC4) % 12) + 12) % 12;
}

function hannWindow(i: number, size: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
}

/** Sums FFT bin magnitudes into their nearest pitch class, across all represented octaves. */
export function computeChromaForFrame(
  magnitudes: Float64Array,
  sampleRate: number,
  fftSize: number,
): Float64Array {
  const chroma = new Float64Array(12);
  for (let bin = 1; bin < magnitudes.length / 2; bin++) {
    const freq = (bin * sampleRate) / fftSize;
    if (freq < MIN_ANALYSIS_FREQ_HZ || freq > MAX_ANALYSIS_FREQ_HZ) continue;
    chroma[frequencyToPitchClass(freq)] += magnitudes[bin];
  }
  return chroma;
}

/** Averages the chroma profile across (up to) maxFrames non-overlapping, Hann-windowed frames spread across the signal. */
export function extractChromaProfile(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number = DEFAULT_FFT_SIZE,
  maxFrames: number = DEFAULT_MAX_FRAMES,
): Float64Array {
  const size = nextPowerOfTwo(fftSize);
  const chroma = new Float64Array(12);
  const totalFrames = Math.floor(samples.length / size);
  if (totalFrames === 0) return chroma;

  const frameCount = Math.min(totalFrames, maxFrames);
  const step = Math.max(1, Math.floor(totalFrames / frameCount));

  let framesProcessed = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * step * size;
    if (start + size > samples.length) break;

    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      real[i] = samples[start + i] * hannWindow(i, size);
    }
    fft(real, imag);

    const magnitudes = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      magnitudes[i] = Math.hypot(real[i], imag[i]);
    }

    const frameChroma = computeChromaForFrame(magnitudes, sampleRate, size);
    for (let i = 0; i < 12; i++) chroma[i] += frameChroma[i];
    framesProcessed++;
  }

  if (framesProcessed === 0) return chroma;
  const max = Math.max(...Array.from(chroma), 1e-9);
  for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

function rotateProfile(profile: readonly number[], tonic: number): number[] {
  return profile.map((_, i) => profile[(i - tonic + 12) % 12]);
}

function pearsonCorrelation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i++) {
    const deviationA = a[i] - meanA;
    const deviationB = b[i] - meanB;
    numerator += deviationA * deviationB;
    denomA += deviationA * deviationA;
    denomB += deviationB * deviationB;
  }
  const denominator = Math.sqrt(denomA * denomB);
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Krumhansl-Schmuckler: correlates the chroma profile against all 24 rotated major/minor key profiles. */
export function detectKeyFromChroma(chroma: Float64Array): DetectedKey {
  const chromaArray = Array.from(chroma);
  let best: DetectedKey = { tonicPitchClass: 0, mode: "major", correlation: -Infinity };

  for (let tonic = 0; tonic < 12; tonic++) {
    const majorScore = pearsonCorrelation(chromaArray, rotateProfile(MAJOR_PROFILE, tonic));
    if (majorScore > best.correlation) {
      best = { tonicPitchClass: tonic, mode: "major", correlation: majorScore };
    }
    const minorScore = pearsonCorrelation(chromaArray, rotateProfile(MINOR_PROFILE, tonic));
    if (minorScore > best.correlation) {
      best = { tonicPitchClass: tonic, mode: "minor", correlation: minorScore };
    }
  }

  return best;
}

export function toCamelotNotation(key: DetectedKey): string {
  return key.mode === "major"
    ? MAJOR_CAMELOT[key.tonicPitchClass]
    : MINOR_CAMELOT[key.tonicPitchClass];
}

/** Decode-to-Camelot in one step, given already-decoded PCM (mono-summed across channels). */
export function detectKey(samples: Float32Array, sampleRate: number): string {
  const chroma = extractChromaProfile(samples, sampleRate);
  return toCamelotNotation(detectKeyFromChroma(chroma));
}
