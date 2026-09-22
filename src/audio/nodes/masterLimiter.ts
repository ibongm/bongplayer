import { rampLinear } from "../utils";

// Near-brickwall limiter: catches transients just under 0 dBFS with a fast
// attack so the crossfaded mix + sampler sum never clips the master output.
const LIMITER_THRESHOLD_DB = -0.5;
const LIMITER_RATIO = 20;
const LIMITER_KNEE_DB = 0;
const LIMITER_ATTACK_SECONDS = 0.003;
const LIMITER_RELEASE_SECONDS = 0.25;

const EMERGENCY_DUCK_GAIN = 0.2; // -80% amplitude
const EMERGENCY_DUCK_SECONDS = 0.2;
const UNITY_GAIN = 1;

export interface MasterLimiter {
  /** Pre-limiter summing point: crossfaded music mix + samplerBus output connect here. */
  readonly input: GainNode;
  readonly compressor: DynamicsCompressorNode;
  /** Post-limiter output; connect to context.destination. */
  readonly output: GainNode;
  /** Ramps output to -80% amplitude over 200ms (dead-air watchdog / safety cutoff). */
  duckEmergency(rampSeconds?: number): void;
  /** Restores output to unity gain. */
  restoreEmergency(rampSeconds?: number): void;
  dispose(): void;
}

export function createMasterLimiter(context: BaseAudioContext): MasterLimiter {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const output = context.createGain();

  // Fixed limiter characteristics — never changed at runtime, so direct
  // assignment (initial state, before any audio flows) is correct here.
  compressor.threshold.value = LIMITER_THRESHOLD_DB;
  compressor.ratio.value = LIMITER_RATIO;
  compressor.knee.value = LIMITER_KNEE_DB;
  compressor.attack.value = LIMITER_ATTACK_SECONDS;
  compressor.release.value = LIMITER_RELEASE_SECONDS;

  input.connect(compressor);
  compressor.connect(output);

  function duckEmergency(rampSeconds: number = EMERGENCY_DUCK_SECONDS): void {
    rampLinear(output.gain, EMERGENCY_DUCK_GAIN, context, rampSeconds);
  }

  function restoreEmergency(rampSeconds: number = EMERGENCY_DUCK_SECONDS): void {
    rampLinear(output.gain, UNITY_GAIN, context, rampSeconds);
  }

  function dispose(): void {
    input.disconnect();
    compressor.disconnect();
    output.disconnect();
  }

  return { input, compressor, output, duckEmergency, restoreEmergency, dispose };
}
