import { useEffect } from "react";
import { getMasterGraph } from "../audio/masterGraph";
import { useMixerStore } from "../store/useMixerStore";
import type { DeckId, EqBand } from "../types/deck";

const EQ_BANDS: readonly EqBand[] = ["low", "mid", "high"];
const DECKS: readonly DeckId[] = ["a", "b"];

/**
 * Applies every useMixerStore field to the real master graph's nodes —
 * subscribing to the whole mixer state and re-applying it wholesale on any
 * change (the mixer updates at UI/knob-turn frequency, not 60fps, so this
 * is cheap enough to not need per-field subscriptions). Mount this once
 * near the app root, alongside the deck controllers.
 */
export function useMixerController(): void {
  const mixerState = useMixerStore();

  useEffect(() => {
    const graph = getMasterGraph();

    for (const deck of DECKS) {
      const engine = deck === "a" ? graph.deckA : graph.deckB;
      const channel = mixerState.channels[deck];

      engine.setTrimDb(channel.trimDb);
      engine.setVolumeFader(channel.volumeFader);
      engine.filter.setPosition(channel.filterPosition);

      for (const band of EQ_BANDS) {
        engine.eq[band].setGainDb(channel.eq[band]);
        engine.eq[band].setKilled(channel.eqKilled[band]);
      }
    }

    graph.crossfade.setPosition(mixerState.crossfaderPosition, 0.02, mixerState.crossfaderCurve);
    graph.setMasterGainDb(mixerState.masterGainDb);
    graph.pflBus.setCueLevel(mixerState.cueGainDb);
  }, [mixerState]);
}
