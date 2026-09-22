import { clamp, expInterpolate, rampTarget } from "../utils";

const MIN_FREQ_HZ = 20;
const MAX_FREQ_HZ = 20000;
const FILTER_Q = 0.707; // Butterworth (maximally flat), no resonant peak at the cutoff

export interface BipolarFilter {
  readonly node: BiquadFilterNode;
  /**
   * Sets the single-knob position: -1 = full highpass sweep (cuts lows),
   * 0 = bypass (fully open), +1 = full lowpass sweep (cuts highs).
   */
  setPosition(position: number, rampSeconds?: number): void;
  dispose(): void;
}

/** Normalized single-knob bipolar LPF/HPF sweep, per the classic DJ mixer filter knob. */
export function createBipolarFilter(context: BaseAudioContext): BipolarFilter {
  const node = context.createBiquadFilter();
  node.type = "lowpass";
  // Initial state (fully open, no cut), before any audio flows — direct
  // assignment is correct here (see musicBus.ts); setPosition() below uses
  // rampTarget for all subsequent runtime changes.
  node.Q.value = FILTER_Q;
  node.frequency.value = MAX_FREQ_HZ;

  function setPosition(position: number, rampSeconds = 0.03): void {
    const clamped = clamp(position, -1, 1);

    if (clamped < 0) {
      node.type = "highpass";
      const frequency = expInterpolate(-clamped, MIN_FREQ_HZ, MAX_FREQ_HZ);
      rampTarget(node.frequency, frequency, context, rampSeconds);
    } else if (clamped > 0) {
      node.type = "lowpass";
      const frequency = expInterpolate(1 - clamped, MIN_FREQ_HZ, MAX_FREQ_HZ);
      rampTarget(node.frequency, frequency, context, rampSeconds);
    } else {
      node.type = "lowpass";
      rampTarget(node.frequency, MAX_FREQ_HZ, context, rampSeconds);
    }
  }

  function dispose(): void {
    node.disconnect();
  }

  return { node, setPosition, dispose };
}
