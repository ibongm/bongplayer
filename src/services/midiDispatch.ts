/**
 * Turns a controller-neutral DeckAction (src/services/midi/parser.ts) into
 * real calls against the stores and audio engine — the piece that was
 * missing for the MIDI decode layer to actually do anything.
 */

import type { DeckAction, JogMode } from "./midi/types";
import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import { useMixerStore } from "../store/useMixerStore";
import { getMasterGraph, deckEngineFor } from "../audio/masterGraph";
import { activateHotCue, activateSamplerSlot } from "./padActions";
import type { DeckId } from "../types/deck";

const EQ_MIN_DB = -24;
const EQ_MAX_DB = 6;

// Jog wheel "delta" ticks translated into a seek nudge, in seconds per tick.
// "search" (the outer ring) jumps much further per tick than nudging/scratching.
const JOG_SECONDS_PER_TICK: Readonly<Record<JogMode, number>> = {
  scratch: 0.02,
  bend: 0.02,
  search: 0.5,
};

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

export function applyDeckAction(action: DeckAction): void {
  switch (action.type) {
    case "play": {
      // The DDJ-400 (and most controllers) have one PLAY/PAUSE button, not
      // separate play/pause bindings — toggle on the press edge.
      if (!action.down) return;
      const store = deckStoreFor(action.deck);
      if (store.getState().track === null) return;
      const engine = deckEngineFor(getMasterGraph(), action.deck);
      if (engine.isPlaying()) {
        engine.pause();
        store.getState().pause();
      } else {
        engine.play();
        store.getState().play();
      }
      return;
    }

    case "pause": {
      if (!action.down) return;
      const store = deckStoreFor(action.deck);
      if (store.getState().track === null) return;
      deckEngineFor(getMasterGraph(), action.deck).pause();
      store.getState().pause();
      return;
    }

    case "cue": {
      if (!action.down) return;
      const store = deckStoreFor(action.deck);
      if (store.getState().track === null) return;
      deckEngineFor(getMasterGraph(), action.deck).stop();
      store.getState().stop();
      return;
    }

    case "pitch": {
      const store = deckStoreFor(action.deck);
      const range = store.getState().pitchRange;
      store.getState().setPitchPercent(action.normalized * range);
      return;
    }

    case "jog": {
      const store = deckStoreFor(action.deck);
      if (store.getState().track === null) return;
      const next =
        store.getState().currentTimeSeconds + action.delta * JOG_SECONDS_PER_TICK[action.mode];
      deckEngineFor(getMasterGraph(), action.deck).seek(next);
      store.getState().seek(next);
      return;
    }

    case "eq": {
      const db = EQ_MIN_DB + action.value * (EQ_MAX_DB - EQ_MIN_DB);
      useMixerStore.getState().setEqGain(action.deck, action.band, db);
      return;
    }

    case "filter": {
      useMixerStore.getState().setFilterPosition(action.deck, action.value * 2 - 1);
      return;
    }

    case "crossfade": {
      useMixerStore.getState().setCrossfaderPosition(action.value);
      return;
    }

    case "volume": {
      useMixerStore.getState().setVolumeFader(action.deck, action.value);
      return;
    }

    case "hotcue": {
      if (!action.down) return;
      activateHotCue(action.deck, action.index);
      return;
    }

    case "sampler": {
      if (!action.down) return;
      activateSamplerSlot(action.slot);
      return;
    }
  }
}
