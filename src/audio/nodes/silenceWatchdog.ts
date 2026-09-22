import { gainToDb } from "../utils";

const DEFAULT_THRESHOLD_DB = -50;
const DEFAULT_GRACE_MS = 3000;
const DEFAULT_CHECK_INTERVAL_MS = 250;
const DEFAULT_FFT_SIZE = 2048;

export interface SilenceDetector {
  /** Feeds one level reading; returns true the instant silence has persisted >= graceMs. */
  update(levelDb: number, nowMs: number): boolean;
  reset(): void;
}

/**
 * Pure, testable silence-persistence logic, decoupled from the AnalyserNode
 * polling that drives it in createSilenceWatchdog below — this is what
 * actually gets unit tested; the polling glue does not (see AGENTS.md §5:
 * AnalyserNode readings are only meaningful against a live, real-time
 * AudioContext, not something OfflineAudioContext testing can exercise).
 */
export function createSilenceDetector(
  thresholdDb: number = DEFAULT_THRESHOLD_DB,
  graceMs: number = DEFAULT_GRACE_MS,
): SilenceDetector {
  let silenceStartMs: number | null = null;

  return {
    update(levelDb, nowMs) {
      if (levelDb > thresholdDb) {
        silenceStartMs = null;
        return false;
      }
      if (silenceStartMs === null) {
        silenceStartMs = nowMs;
      }
      return nowMs - silenceStartMs >= graceMs;
    },
    reset() {
      silenceStartMs = null;
    },
  };
}

export interface SilenceWatchdogOptions {
  readonly thresholdDb?: number;
  readonly graceMs?: number;
  readonly checkIntervalMs?: number;
}

export interface SilenceWatchdog {
  /** Connect the signal to monitor (e.g. masterLimiter.output) into this. */
  readonly analyser: AnalyserNode;
  /**
   * Begins polling. `onSilenceDetected` fires once when silence first
   * crosses the grace period, then the detector resets — callers that want
   * repeated firing (e.g. still silent after taking a fallback action)
   * should call start() again or handle repeat logic themselves.
   */
  start(onSilenceDetected: () => void): void;
  stop(): void;
  dispose(): void;
}

export function createSilenceWatchdog(
  context: BaseAudioContext,
  options: SilenceWatchdogOptions = {},
): SilenceWatchdog {
  const {
    thresholdDb = DEFAULT_THRESHOLD_DB,
    graceMs = DEFAULT_GRACE_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  } = options;

  const analyser = context.createAnalyser();
  analyser.fftSize = DEFAULT_FFT_SIZE;
  const sampleBuffer = new Float32Array(analyser.fftSize);
  const detector = createSilenceDetector(thresholdDb, graceMs);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function measureLevelDb(): number {
    analyser.getFloatTimeDomainData(sampleBuffer);
    let sumSquares = 0;
    for (const sample of sampleBuffer) {
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleBuffer.length);
    return gainToDb(rms);
  }

  function start(onSilenceDetected: () => void): void {
    stop();
    detector.reset();
    intervalId = setInterval(() => {
      if (detector.update(measureLevelDb(), Date.now())) {
        detector.reset();
        onSilenceDetected();
      }
    }, checkIntervalMs);
  }

  function stop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function dispose(): void {
    stop();
    analyser.disconnect();
  }

  return { analyser, start, stop, dispose };
}
