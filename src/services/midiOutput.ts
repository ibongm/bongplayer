/**
 * Sends bidirectional LED feedback to connected MIDI outputs, driven by
 * real store state. Owns no MIDIAccess lifecycle itself — midiAccess.ts
 * calls attachMidiOutput/detachMidiOutput alongside its own input hot-plug
 * handling (same access.outputs / statechange event, just filtered by
 * port.type), and startMidiLedSync() once to begin pushing updates.
 */

import {
  hotCueLedMessages,
  playCueLedMessages,
  samplerLedMessages,
  type LedMessage,
} from "./midi/ddj400Leds";
import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import { useSamplerStore } from "../store/useSamplerStore";
import type { DeckId } from "../types/deck";

const connectedOutputs = new Map<string, MIDIOutput>();

function matchesDdj400(name: string | null | undefined): boolean {
  const lower = (name ?? "").toLowerCase();
  return lower.includes("ddj-400") || lower.includes("ddj400");
}

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

function broadcast(messages: readonly LedMessage[]): void {
  for (const output of connectedOutputs.values()) {
    for (const message of messages) {
      try {
        output.send([message.status, message.note, message.velocity]);
      } catch (error) {
        console.warn(`Failed to send MIDI LED update to "${output.name ?? output.id}":`, error);
      }
    }
  }
}

function refreshDeckLeds(deck: DeckId): void {
  const state = deckStoreFor(deck).getState();
  broadcast(playCueLedMessages(deck, state.playbackState));
  broadcast(hotCueLedMessages(deck, state.hotCues));
}

function refreshSamplerLeds(): void {
  const slots = useSamplerStore.getState().slots;
  broadcast(samplerLedMessages("a", slots));
  broadcast(samplerLedMessages("b", slots));
}

function refreshAllLeds(): void {
  refreshDeckLeds("a");
  refreshDeckLeds("b");
  refreshSamplerLeds();
}

/** No-ops for outputs that aren't a recognized DDJ-400 (unmapped hardware has no LED addresses to target). */
export function attachMidiOutput(output: MIDIOutput): void {
  if (connectedOutputs.has(output.id) || !matchesDdj400(output.name)) return;
  connectedOutputs.set(output.id, output);
  refreshAllLeds();
}

export function detachMidiOutput(outputId: string): void {
  connectedOutputs.delete(outputId);
}

/** Subscribes to the deck/sampler stores and pushes an LED refresh on every change. Returns a teardown function. */
export function startMidiLedSync(): () => void {
  refreshAllLeds();
  const unsubscribeA = useDeckAStore.subscribe(() => refreshDeckLeds("a"));
  const unsubscribeB = useDeckBStore.subscribe(() => refreshDeckLeds("b"));
  const unsubscribeSampler = useSamplerStore.subscribe(() => refreshSamplerLeds());

  return () => {
    unsubscribeA();
    unsubscribeB();
    unsubscribeSampler();
  };
}
