/**
 * Autocorrelation BPM detection (AGENTS §3, workers/audioAnalysis.worker.ts):
 * compute a per-frame energy "onset envelope," half-wave-rectify its
 * frame-to-frame increase (onset flux), then autocorrelate that envelope
 * across the lag range corresponding to a plausible tempo — the lag with
 * the strongest self-similarity is the beat period.
 */

const DEFAULT_FRAME_SIZE = 1024;
const DEFAULT_MIN_BPM = 60;
const DEFAULT_MAX_BPM = 180;

/** RMS energy per non-overlapping frame, then half-wave-rectified frame-to-frame increase ("onset flux"). */
export function computeOnsetEnvelope(
  samples: Float32Array,
  frameSize: number = DEFAULT_FRAME_SIZE,
): Float32Array {
  const frameCount = Math.floor(samples.length / frameSize);
  const energy = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    let sumSquares = 0;
    const start = frame * frameSize;
    for (let i = start; i < start + frameSize; i++) {
      sumSquares += samples[i] * samples[i];
    }
    energy[frame] = Math.sqrt(sumSquares / frameSize);
  }

  const onset = new Float32Array(frameCount);
  for (let i = 1; i < frameCount; i++) {
    const diff = energy[i] - energy[i - 1];
    onset[i] = diff > 0 ? diff : 0;
  }
  return onset;
}

/**
 * Finds the BPM whose beat period best explains the onset envelope's
 * self-similarity. `envelopeFrameRate` is envelope samples per second
 * (sampleRate / frameSize). Returns 0 if the envelope is too short to
 * contain even one full beat period in the search range.
 */
export function detectBpmFromOnsetEnvelope(
  onset: Float32Array,
  envelopeFrameRate: number,
  minBpm: number = DEFAULT_MIN_BPM,
  maxBpm: number = DEFAULT_MAX_BPM,
): number {
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * envelopeFrameRate));
  const maxLag = Math.ceil((60 / minBpm) * envelopeFrameRate);
  if (minLag >= onset.length) return 0;

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= Math.min(maxLag, onset.length - 1); lag++) {
    let score = 0;
    for (let i = 0; i + lag < onset.length; i++) {
      score += onset[i] * onset[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return (60 * envelopeFrameRate) / bestLag;
}

/** Decodes-to-BPM in one step, given already-decoded PCM (mono-summed across channels). */
export function detectBpm(
  samples: Float32Array,
  sampleRate: number,
  frameSize: number = DEFAULT_FRAME_SIZE,
): number {
  const onset = computeOnsetEnvelope(samples, frameSize);
  const envelopeFrameRate = sampleRate / frameSize;
  return detectBpmFromOnsetEnvelope(onset, envelopeFrameRate);
}
