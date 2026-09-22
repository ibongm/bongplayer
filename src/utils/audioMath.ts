/**
 * Pure gain, pitch, crossfader, and beat-grid helpers.
 * No audio nodes are created here — callers apply the numbers to the graph.
 */

const SILENCE_FLOOR_DB = -120;
const MIN_PLAYBACK_RATE = 1e-4;
const PITCH_14_CENTER = 8192;
const PITCH_14_MAX = 16383;
const SHARP_CUT_START = 0.45;
const SHARP_CUT_END = 0.55;

export type PitchRangePercent = 8 | 16 | 50;

export type CrossfaderCurve = "linear" | "constantPower" | "sharpCut";

export interface CrossfaderGains {
  readonly a: number;
  readonly b: number;
}

export interface BeatPosition {
  /** 1-based absolute beat. 0 when bpm or time is unusable. */
  readonly beat: number;
  /** 1-based bar number. 0 when bpm or time is unusable. */
  readonly bar: number;
  /** 1-based beat inside the bar. 0 when bpm or time is unusable. */
  readonly beatInBar: number;
  /** Fraction through the current beat, in [0, 1). */
  readonly phase: number;
  readonly elapsedBeats: number;
}

const EMPTY_BEAT: BeatPosition = {
  beat: 0,
  bar: 0,
  beatInBar: 0,
  phase: 0,
  elapsedBeats: 0,
};

/**
 * Amplitude ratio from a decibel value. 0 dB is unity.
 * At or below -120 dB, and for non-finite input, the result is silence (0).
 */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= SILENCE_FLOOR_DB) {
    return 0;
  }
  return 10 ** (db / 20);
}

/** Decibels from a linear amplitude. 0 and negative gain are -Infinity. */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return 20 * Math.log10(gain);
}

/**
 * Web Audio playbackRate for a signed pitch percentage.
 * +8 → 1.08. The floor keeps the rate above 0, which exponential ramps require.
 */
export function pitchPercentToPlaybackRate(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 1;
  }
  const rate = 1 + percent / 100;
  return rate < MIN_PLAYBACK_RATE ? MIN_PLAYBACK_RATE : rate;
}

/**
 * playbackRate from a bipolar fader position in [-1, 1] and a ±range.
 * Center (0) is 1.0. `range` is 8, 16, or 50.
 */
export function pitchFaderToPlaybackRate(position: number, range: PitchRangePercent): number {
  return pitchPercentToPlaybackRate(clamp(position, -1, 1, 0) * range);
}

/**
 * Signed percent inside the selected range for a 14-bit pitch fader.
 * 0 is full minus, 8192 is center (0%), 16383 is full plus.
 */
export function pitchBend14ToPercent(value14: number, range: PitchRangePercent): number {
  const clamped = clamp(value14, 0, PITCH_14_MAX, PITCH_14_CENTER);
  return ((clamped - PITCH_14_CENTER) / PITCH_14_CENTER) * range;
}

export function linearCrossfader(position: number): CrossfaderGains {
  const p = clamp01(position);
  return { a: 1 - p, b: p };
}

/** Equal-power law: gainA = cos(p · π / 2), gainB = cos((1 − p) · π / 2). */
export function constantPowerCrossfader(position: number): CrossfaderGains {
  const p = clamp01(position);
  return {
    a: Math.cos((p * Math.PI) / 2),
    b: Math.cos(((1 - p) * Math.PI) / 2),
  };
}

/**
 * Full deck A until 45%, a linear ramp across the center 10%, then full deck B.
 * The side that is out is exactly 0.
 */
export function sharpCutCrossfader(position: number): CrossfaderGains {
  const p = clamp01(position);
  if (p <= SHARP_CUT_START) {
    return { a: 1, b: 0 };
  }
  if (p >= SHARP_CUT_END) {
    return { a: 0, b: 1 };
  }
  const span = SHARP_CUT_END - SHARP_CUT_START;
  const t = (p - SHARP_CUT_START) / span;
  return { a: 1 - t, b: t };
}

export function crossfaderGains(position: number, curve: CrossfaderCurve): CrossfaderGains {
  switch (curve) {
    case "linear":
      return linearCrossfader(position);
    case "constantPower":
      return constantPowerCrossfader(position);
    case "sharpCut":
      return sharpCutCrossfader(position);
  }
}

/** Seconds in one beat. 0 when bpm is missing or not positive. */
export function secondsPerBeat(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return 0;
  }
  return 60 / bpm;
}

/**
 * Where `elapsedSeconds` falls on a beat grid. Beats and bars are 1-based.
 * `beatsPerBar` defaults to 4 and is clamped to an integer of at least 1.
 */
export function beatPosition(bpm: number, elapsedSeconds: number, beatsPerBar = 4): BeatPosition {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return EMPTY_BEAT;
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return EMPTY_BEAT;
  }
  const perBar = resolveBeatsPerBar(beatsPerBar);
  const elapsedBeats = (elapsedSeconds * bpm) / 60;
  const whole = Math.floor(elapsedBeats);
  return {
    beat: whole + 1,
    bar: Math.floor(whole / perBar) + 1,
    beatInBar: (whole % perBar) + 1,
    phase: elapsedBeats - whole,
    elapsedBeats,
  };
}

/**
 * Elapsed time, in seconds, of the nearest beat boundary.
 * An exact halfway point stays on the earlier beat.
 */
export function quantizeToNearestBeat(bpm: number, elapsedSeconds: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return 0;
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return 0;
  }
  const elapsedBeats = (elapsedSeconds * bpm) / 60;
  const whole = Math.floor(elapsedBeats);
  const fraction = elapsedBeats - whole;
  const nearest = fraction > 0.5 ? whole + 1 : whole;
  return nearest * (60 / bpm);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1, 0);
}

function resolveBeatsPerBar(beatsPerBar: number): number {
  if (!Number.isFinite(beatsPerBar)) {
    return 4;
  }
  const whole = Math.floor(beatsPerBar);
  return whole >= 1 ? whole : 1;
}
