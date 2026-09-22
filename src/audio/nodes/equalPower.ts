import { clamp, rampTarget } from "../utils";
import { crossfaderGains, type CrossfaderCurve } from "../../utils/audioMath";

export interface EqualPowerCrossfade {
  /** Deck A signal connects here. */
  readonly gainA: GainNode;
  /** Deck B signal connects here. */
  readonly gainB: GainNode;
  /** Summed output; connect downstream to masterLimiter's input. */
  readonly output: GainNode;
  /**
   * Sets crossfader position: 0 = full Deck A, 1 = full Deck B. `curve`
   * defaults to constant-power (this node's namesake behavior); pass
   * "linear"/"sharpCut" to reuse the same two gain nodes for the other
   * curves useMixerStore's crossfaderCurve offers, via audioMath.ts's
   * pure gain-law functions.
   */
  setPosition(position: number, rampSeconds?: number, curve?: CrossfaderCurve): void;
  dispose(): void;
}

/**
 * Constant-power crossfade by default: gainA = cos(p·π/2), gainB = cos((1-p)·π/2).
 * Keeps perceived loudness constant through the crossfade (gainA² + gainB² ≈ 1).
 */
export function createEqualPowerCrossfade(context: BaseAudioContext): EqualPowerCrossfade {
  const gainA = context.createGain();
  const gainB = context.createGain();
  const output = context.createGain();

  gainA.connect(output);
  gainB.connect(output);

  function setPosition(
    position: number,
    rampSeconds = 0.02,
    curve: CrossfaderCurve = "constantPower",
  ): void {
    const p = clamp(position, 0, 1);
    const gains = crossfaderGains(p, curve);
    rampTarget(gainA.gain, gains.a, context, rampSeconds);
    rampTarget(gainB.gain, gains.b, context, rampSeconds);
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
