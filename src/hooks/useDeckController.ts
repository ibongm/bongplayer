import { useEffect, useMemo } from "react";
import { getMasterGraph, deckEngineFor } from "../audio/masterGraph";
import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import type { DeckId } from "../types/deck";
import { pitchPercentToPlaybackRate } from "../utils/audioMath";

export interface DeckController {
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  /** Momentary tempo nudge (e.g. a held pitch-bend button), independent of the fader's resting position. */
  bendStart(directionPercent: number): void;
  /** Releases the bend, returning to the fader's own rate. */
  bendEnd(): void;
}

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

/**
 * Bridges a deck's pure Zustand store (Phase 3) to its real DeckEngine
 * (Phase 6): keeps playbackRate in sync with the pitch fader, runs the
 * rAF playhead-sync loop while playing, and exposes transport functions
 * that drive both the engine and the store together.
 *
 * Note on Key Lock: `keyLockEnabled` is stored and toggleable, but real key
 * lock (tempo changes without a pitch shift) requires a time-stretching
 * DSP algorithm this codebase doesn't implement — no AudioWorklet-based
 * phase vocoder exists here. The pitch fader always affects both speed and
 * pitch together (standard resampling), regardless of the toggle, rather
 * than silently faking correct-sounding-but-wrong behavior.
 */
export function useDeckController(deck: DeckId): DeckController {
  const store = deckStoreFor(deck);
  const engine = useMemo(() => deckEngineFor(getMasterGraph(), deck), [deck]);

  const pitchPercent = store((state) => state.pitchPercent);
  useEffect(() => {
    engine.setPlaybackRate(pitchPercentToPlaybackRate(pitchPercent));
  }, [engine, pitchPercent]);

  const playbackState = store((state) => state.playbackState);
  useEffect(() => {
    if (playbackState !== "playing") return;
    let frameId: number;
    const tick = () => {
      store.getState().tick(engine.getCurrentTime());
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playbackState, engine, store]);

  return useMemo(
    () => ({
      play() {
        engine.play();
        store.getState().play();
      },
      pause() {
        engine.pause();
        store.getState().pause();
      },
      stop() {
        engine.stop();
        store.getState().stop();
      },
      seek(seconds: number) {
        engine.seek(seconds);
        store.getState().seek(seconds);
      },
      bendStart(directionPercent: number) {
        engine.setPlaybackRate(
          pitchPercentToPlaybackRate(store.getState().pitchPercent + directionPercent),
        );
      },
      bendEnd() {
        engine.setPlaybackRate(pitchPercentToPlaybackRate(store.getState().pitchPercent));
      },
    }),
    [engine, store],
  );
}
