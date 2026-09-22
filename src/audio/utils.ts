/**
 * Shared math and AudioParam automation helpers for the node modules in
 * src/audio/nodes/. Centralized here so every node follows the same
 * ramp-not-direct-assignment discipline mandated by AGENTS.md §5.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-6));
}

/** Logarithmic interpolation, for mapping a normalized [0,1] knob position to a frequency range. */
export function expInterpolate(t: number, min: number, max: number): number {
  const clamped = clamp(t, 0, 1);
  return min * Math.pow(max / min, clamped);
}

/**
 * Ramps an AudioParam linearly to `value` over exactly `durationSeconds`.
 * Use for automations with a spec'd fixed duration (e.g. emergency ducking).
 */
export function rampLinear(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  durationSeconds: number,
): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + Math.max(durationSeconds, 0));
}

/**
 * Smoothly approaches `value` using an exponential time-constant ramp — the
 * default choice for continuous knob/fader automation with no fixed duration.
 *
 * `timeConstant` must be > 0 — setTargetAtTime divides by it internally, so a
 * 0 is degenerate (the param may not reach `value` at all). For an
 * instantaneous initial value with no ramp, call `param.setValueAtTime(value,
 * context.currentTime)` directly instead of rampTarget(..., 0).
 */
export function rampTarget(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  timeConstant = 0.05,
): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}
