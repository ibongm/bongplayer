import { dbToGain, rampLinear } from "../utils";

/** Baseline headroom applied to every deck so two decks summed at unity never clip. */
const BASE_GAIN_DB = -9;

export interface MusicBus {
  /** Deck source (or its channel strip output) connects here. */
  readonly input: GainNode;
  /** Downstream node (threeBandEQ input) connects from here. */
  readonly output: GainNode;
  /** Ramps the bus down to duck under a triggered sample, per AGENTS.md §5 ramp discipline. */
  duck(depthDb: number, attackSeconds: number): void;
  /** Ramps the bus back to its −9 dB baseline. */
  restore(releaseSeconds: number): void;
  dispose(): void;
}

/**
 * Per-deck summing bus: a single −9 dB gain stage that both provides mixing
 * headroom and serves as the target for sample-triggered ducking. Create one
 * instance per deck (Deck A, Deck B); they sum acoustically downstream at
 * the crossfader / master limiter.
 */
export function createMusicBus(context: BaseAudioContext): MusicBus {
  const gainNode = context.createGain();
  // Direct assignment is correct here (not a runtime automation change): the
  // node has no audio flowing through it yet, so there's no click to avoid,
  // and it sets the true intrinsic value that later ramps correctly anchor
  // from (a queued setValueAtTime read back via .value before any render
  // pass is not guaranteed to reflect the scheduled event).
  gainNode.gain.value = dbToGain(BASE_GAIN_DB);

  function duck(depthDb: number, attackSeconds: number): void {
    rampLinear(gainNode.gain, dbToGain(BASE_GAIN_DB - Math.abs(depthDb)), context, attackSeconds);
  }

  function restore(releaseSeconds: number): void {
    rampLinear(gainNode.gain, dbToGain(BASE_GAIN_DB), context, releaseSeconds);
  }

  function dispose(): void {
    gainNode.disconnect();
  }

  return { input: gainNode, output: gainNode, duck, restore, dispose };
}
