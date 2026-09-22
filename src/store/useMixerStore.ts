import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DeckId, EqBand } from "../types/deck";
import type { CrossfaderCurve } from "../utils/audioMath";
import { clamp } from "./storeUtils";

// Mirrors the node graph's own clamped ranges (Phase 2):
// src/audio/nodes/threeBandEQ.ts and bipolarFilter.ts.
const EQ_MIN_DB = -24;
const EQ_MAX_DB = 6;
const FILTER_MIN = -1;
const FILTER_MAX = 1;
const FADER_MIN = 0;
const FADER_MAX = 1;

export interface ChannelStrip {
  readonly trimDb: number;
  readonly eq: Readonly<Record<EqBand, number>>;
  readonly eqKilled: Readonly<Record<EqBand, boolean>>;
  readonly filterPosition: number;
  readonly volumeFader: number;
  readonly pflEnabled: boolean;
}

export interface MixerState {
  readonly channels: Readonly<Record<DeckId, ChannelStrip>>;
  readonly crossfaderPosition: number;
  readonly crossfaderCurve: CrossfaderCurve;
  readonly masterGainDb: number;
  readonly cueGainDb: number;

  setTrim(deck: DeckId, db: number): void;
  setEqGain(deck: DeckId, band: EqBand, db: number): void;
  setEqKilled(deck: DeckId, band: EqBand, killed: boolean): void;
  setFilterPosition(deck: DeckId, position: number): void;
  setVolumeFader(deck: DeckId, level: number): void;
  setPfl(deck: DeckId, enabled: boolean): void;
  setCrossfaderPosition(position: number): void;
  setCrossfaderCurve(curve: CrossfaderCurve): void;
  setMasterGainDb(db: number): void;
  setCueGainDb(db: number): void;
  resetChannel(deck: DeckId): void;
}

function defaultChannelStrip(): ChannelStrip {
  return {
    trimDb: 0,
    eq: { low: 0, mid: 0, high: 0 },
    eqKilled: { low: false, mid: false, high: false },
    filterPosition: 0,
    volumeFader: 1,
    pflEnabled: false,
  };
}

function updateChannel(
  channels: Readonly<Record<DeckId, ChannelStrip>>,
  deck: DeckId,
  patch: Partial<ChannelStrip>,
): Readonly<Record<DeckId, ChannelStrip>> {
  return { ...channels, [deck]: { ...channels[deck], ...patch } };
}

export const useMixerStore = create<MixerState>()(
  devtools(
    (set) => ({
      channels: { a: defaultChannelStrip(), b: defaultChannelStrip() },
      crossfaderPosition: 0.5,
      crossfaderCurve: "constantPower",
      masterGainDb: 0,
      cueGainDb: 0,

      setTrim(deck, db) {
        set(
          (state) => ({ channels: updateChannel(state.channels, deck, { trimDb: db }) }),
          false,
          "setTrim",
        );
      },

      setEqGain(deck, band, db) {
        set(
          (state) => ({
            channels: updateChannel(state.channels, deck, {
              eq: { ...state.channels[deck].eq, [band]: clamp(db, EQ_MIN_DB, EQ_MAX_DB) },
            }),
          }),
          false,
          "setEqGain",
        );
      },

      setEqKilled(deck, band, killed) {
        set(
          (state) => ({
            channels: updateChannel(state.channels, deck, {
              eqKilled: { ...state.channels[deck].eqKilled, [band]: killed },
            }),
          }),
          false,
          "setEqKilled",
        );
      },

      setFilterPosition(deck, position) {
        set(
          (state) => ({
            channels: updateChannel(state.channels, deck, {
              filterPosition: clamp(position, FILTER_MIN, FILTER_MAX),
            }),
          }),
          false,
          "setFilterPosition",
        );
      },

      setVolumeFader(deck, level) {
        set(
          (state) => ({
            channels: updateChannel(state.channels, deck, {
              volumeFader: clamp(level, FADER_MIN, FADER_MAX),
            }),
          }),
          false,
          "setVolumeFader",
        );
      },

      setPfl(deck, enabled) {
        set(
          (state) => ({ channels: updateChannel(state.channels, deck, { pflEnabled: enabled }) }),
          false,
          "setPfl",
        );
      },

      setCrossfaderPosition(position) {
        set({ crossfaderPosition: clamp(position, 0, 1) }, false, "setCrossfaderPosition");
      },

      setCrossfaderCurve(curve) {
        set({ crossfaderCurve: curve }, false, "setCrossfaderCurve");
      },

      setMasterGainDb(db) {
        set({ masterGainDb: db }, false, "setMasterGainDb");
      },

      setCueGainDb(db) {
        set({ cueGainDb: db }, false, "setCueGainDb");
      },

      resetChannel(deck) {
        set(
          (state) => ({ channels: { ...state.channels, [deck]: defaultChannelStrip() } }),
          false,
          "resetChannel",
        );
      },
    }),
    { name: "mixer" },
  ),
);
