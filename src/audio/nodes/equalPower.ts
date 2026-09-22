import { clamp, rampTarget } from "../utils";

export interface EqualPowerCrossfade {
  /** Deck A signal connects here. */
  readonly gainA: GainNode;
  /** Deck B signal connects here. */
  readonly gainB: GainNode;
  /** Summed output; connect downstream to masterLimiter's input. */
  readonly output: GainNode;
  /** Sets crossfader position: 0 = full Deck A, 1 = full Deck B. */
  setPosition(position: number, rampSeconds?: number): void;
  dispose(): void;
}

/**
 * Constant-power crossfade: gainA = cos(p·π/2), gainB = cos((1-p)·π/2).
 * Keeps perceived loudness constant through the crossfade (gainA² + gainB² ≈ 1).
 */
export function createEqualPowerCrossfade(context: BaseAudioContext): EqualPowerCrossfade {
  const gainA = context.createGain();
  const gainB = context.createGain();
  const output = context.createGain();

  gainA.connect(output);
  gainB.connect(output);

  function setPosition(position: number, rampSeconds = 0.02): void {
    const p = clamp(position, 0, 1);
    const gainAValue = Math.cos((p * Math.PI) / 2);
    const gainBValue = Math.cos(((1 - p) * Math.PI) / 2);
    rampTarget(gainA.gain, gainAValue, context, rampSeconds);
    rampTarget(gainB.gain, gainBValue, context, rampSeconds);
  }

  // Center position (both decks audible) — initial state, before any audio
  // flows, so direct assignment is correct here. See musicBus.ts.
  const centerGain = Math.cos(Math.PI / 4);
  gainA.gain.value = centerGain;
  gainB.gain.value = centerGain;

  function dispose(): void {
    gainA.disconnect();
    gainB.disconnect();
    output.disconnect();
  }

  return { gainA, gainB, output, setPosition, dispose };
}
