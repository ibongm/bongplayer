import { clamp, rampTarget } from "../utils";

const LOW_FREQ_HZ = 250;
const MID_FREQ_HZ = 1000;
const HIGH_FREQ_HZ = 8000;
const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 6;
const MID_Q = 1;
// Deeper than the knob's own floor so "kill" is audibly distinct from "gain all the way down".
const KILL_GAIN_DB = -60;

export interface EQBand {
  readonly filter: BiquadFilterNode;
  setGainDb(db: number, rampSeconds?: number): void;
  setKilled(killed: boolean, rampSeconds?: number): void;
  dispose(): void;
}

export interface ThreeBandEQ {
  /** Deck signal (post bipolarFilter or pre, per graph topology) connects here. */
  readonly input: AudioNode;
  /** Connect downstream to the equalPower crossfade input. */
  readonly output: AudioNode;
  readonly low: EQBand;
  readonly mid: EQBand;
  readonly high: EQBand;
  dispose(): void;
}

function createBand(
  context: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q: number | null,
): EQBand {
  const filter = context.createBiquadFilter();
  filter.type = type;
  // Initial state, before any audio flows — direct assignment is correct
  // here (see musicBus.ts); setGainDb/setKilled below use rampTarget for
  // all subsequent runtime changes.
  filter.frequency.value = frequency;
  if (q !== null) {
    filter.Q.value = q;
  }
  filter.gain.value = 0;

  // Bands are chained in series (low -> mid -> high), so "kill" must only
  // floor this band's OWN filter gain, never gate a downstream node — doing
  // the latter would silence the other two bands' frequency content too.
  let lastGainDb = 0;
  let killed = false;

  function setGainDb(db: number, rampSeconds = 0.02): void {
    lastGainDb = clamp(db, MIN_GAIN_DB, MAX_GAIN_DB);
    if (!killed) {
      rampTarget(filter.gain, lastGainDb, context, rampSeconds);
    }
  }

  function setKilled(next: boolean, rampSeconds = 0.02): void {
    killed = next;
    rampTarget(filter.gain, killed ? KILL_GAIN_DB : lastGainDb, context, rampSeconds);
  }

  function dispose(): void {
    filter.disconnect();
  }

  return { filter, setGainDb, setKilled, dispose };
}

/** Three-band EQ (low-shelf/peaking/high-shelf) with independent per-band kill switches. */
export function createThreeBandEQ(context: BaseAudioContext): ThreeBandEQ {
  const low = createBand(context, "lowshelf", LOW_FREQ_HZ, null);
  const mid = createBand(context, "peaking", MID_FREQ_HZ, MID_Q);
  const high = createBand(context, "highshelf", HIGH_FREQ_HZ, null);

  low.filter.connect(mid.filter);
  mid.filter.connect(high.filter);

  function dispose(): void {
    low.dispose();
    mid.dispose();
    high.dispose();
  }

  return { input: low.filter, output: high.filter, low, mid, high, dispose };
}
