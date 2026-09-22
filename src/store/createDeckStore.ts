import { create, type UseBoundStore, type StoreApi } from "zustand";
import { devtools } from "zustand/middleware";
import type { DeckId, SlotIndex } from "../types/deck";
import type { PitchRangePercent } from "../utils/audioMath";
import { clamp } from "./storeUtils";

export interface TrackMetadata {
  readonly filePath: string;
  readonly title: string;
  readonly artist: string | null;
  readonly duration: number;
  /** Populated by Phase 7's BPM/key analysis worker; null until analyzed. */
  readonly bpm: number | null;
  /** Camelot notation (e.g. "8A"); null until analyzed. */
  readonly key: string | null;
  readonly sampleRate: number;
}

export type PlaybackState = "empty" | "loading" | "stopped" | "playing" | "paused";

export interface HotCue {
  readonly index: SlotIndex;
  readonly positionSeconds: number;
  readonly label: string | null;
}

export interface DeckState {
  readonly deck: DeckId;
  readonly track: TrackMetadata | null;
  readonly playbackState: PlaybackState;
  readonly currentTimeSeconds: number;
  readonly pitchPercent: number;
  readonly pitchRange: PitchRangePercent;
  readonly keyLockEnabled: boolean;
  readonly hotCues: readonly HotCue[];

  loadTrack(track: TrackMetadata): void;
  clearTrack(): void;
  play(): void;
  pause(): void;
  stop(): void;
  /** Seeks to an absolute position; clamped to [0, track.duration]. */
  seek(seconds: number): void;
  /** Advances the tracked playhead position — called from the rAF loop that reads the live audio node. */
  tick(currentTimeSeconds: number): void;
  setPitchPercent(percent: number): void;
  setPitchRange(range: PitchRangePercent): void;
  toggleKeyLock(): void;
  setHotCue(index: SlotIndex, positionSeconds: number, label?: string | null): void;
  clearHotCue(index: SlotIndex): void;
  clearAllHotCues(): void;
}

function initialState(deck: DeckId): Omit<DeckState, keyof DeckActions> {
  return {
    deck,
    track: null,
    playbackState: "empty",
    currentTimeSeconds: 0,
    pitchPercent: 0,
    pitchRange: 8,
    keyLockEnabled: false,
    hotCues: [],
  };
}

type DeckActions = Pick<
  DeckState,
  | "loadTrack"
  | "clearTrack"
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "tick"
  | "setPitchPercent"
  | "setPitchRange"
  | "toggleKeyLock"
  | "setHotCue"
  | "clearHotCue"
  | "clearAllHotCues"
>;

/**
 * Builds one deck's store. Deck A and Deck B are structurally identical —
 * see useDeckAStore.ts / useDeckBStore.ts for the two instances — so the
 * logic lives here once rather than duplicated per file.
 */
export function createDeckStore(deck: DeckId): UseBoundStore<StoreApi<DeckState>> {
  return create<DeckState>()(
    devtools(
      (set, get) => ({
        ...initialState(deck),

        loadTrack(track) {
          set(
            { track, playbackState: "stopped", currentTimeSeconds: 0, hotCues: [] },
            false,
            "loadTrack",
          );
        },

        clearTrack() {
          set(
            { track: null, playbackState: "empty", currentTimeSeconds: 0, hotCues: [] },
            false,
            "clearTrack",
          );
        },

        play() {
          if (get().track === null) return;
          set({ playbackState: "playing" }, false, "play");
        },

        pause() {
          if (get().track === null) return;
          set({ playbackState: "paused" }, false, "pause");
        },

        stop() {
          if (get().track === null) return;
          set({ playbackState: "stopped", currentTimeSeconds: 0 }, false, "stop");
        },

        seek(seconds) {
          const duration = get().track?.duration ?? 0;
          set({ currentTimeSeconds: clamp(seconds, 0, duration) }, false, "seek");
        },

        tick(currentTimeSeconds) {
          set({ currentTimeSeconds }, false, "tick");
        },

        setPitchPercent(percent) {
          const range = get().pitchRange;
          set({ pitchPercent: clamp(percent, -range, range) }, false, "setPitchPercent");
        },

        setPitchRange(range) {
          set(
            (state) => ({
              pitchRange: range,
              pitchPercent: clamp(state.pitchPercent, -range, range),
            }),
            false,
            "setPitchRange",
          );
        },

        toggleKeyLock() {
          set((state) => ({ keyLockEnabled: !state.keyLockEnabled }), false, "toggleKeyLock");
        },

        setHotCue(index, positionSeconds, label = null) {
          set(
            (state) => {
              const withoutExisting = state.hotCues.filter((cue) => cue.index !== index);
              return { hotCues: [...withoutExisting, { index, positionSeconds, label }] };
            },
            false,
            "setHotCue",
          );
        },

        clearHotCue(index) {
          set(
            (state) => ({ hotCues: state.hotCues.filter((cue) => cue.index !== index) }),
            false,
            "clearHotCue",
          );
        },

        clearAllHotCues() {
          set({ hotCues: [] }, false, "clearAllHotCues");
        },
      }),
      { name: `deck-${deck}` },
    ),
  );
}
