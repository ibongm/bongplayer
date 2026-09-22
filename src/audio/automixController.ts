/**
 * Automix engine (Phase 7): a ping-pong state machine that alternates the
 * two real decks (A/B), loading useAutomixStore's queue entries into
 * whichever deck is currently idle and transitioning into it as the active
 * deck nears the end of its track. Deliberately a plain polled service, not
 * a React hook — same rationale as deckEngine.ts/masterGraph.ts (AGENTS §5:
 * graph mutations belong in a dedicated service, not component renders).
 * Mount once via initAutomixController() (see App.tsx's initMidiHotPlug /
 * initNativeFileDropListener for the same one-shot-init pattern).
 *
 * The four transition styles all reduce to two pure, testable primitives:
 * a crossfader-position curve over transition progress (crossfaderPositionForTransition)
 * and, for the two styles that need it, an additional per-progress effect
 * (bassSwapKillState's low-EQ swap, or echoOut's growing echo wet level).
 */

import { getAudioContext } from "./context";
import { getMasterGraph, deckEngineFor } from "./masterGraph";
import { clamp } from "./utils";
import {
  useAutomixStore,
  type AutomixQueueEntry,
  type TransitionStyle,
} from "../store/useAutomixStore";
import { useMixerStore } from "../store/useMixerStore";
import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import { decodeTrack } from "../services/trackLoader";
import { analyzeTrackInBackground } from "../services/trackAnalysis";
import type { DeckId } from "../types/deck";

const POLL_INTERVAL_MS = 200;

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

function otherDeck(deck: DeckId): DeckId {
  return deck === "a" ? "b" : "a";
}

/** True once the active deck is within `triggerSecondsBeforeEnd` of its track's end. */
export function shouldStartTransition(
  currentTimeSeconds: number,
  durationSeconds: number,
  triggerSecondsBeforeEnd: number,
): boolean {
  if (durationSeconds <= 0) return false;
  return durationSeconds - currentTimeSeconds <= triggerSecondsBeforeEnd;
}

/**
 * Crossfader position (0 = full Deck A, 1 = full Deck B — equalPower.ts's
 * convention) for a transition moving away from `fromDeck`, at `progress`
 * (0 = transition just started, 1 = complete). "cut" ignores progress and
 * jumps the instant the transition begins — no gradual crossfade region.
 */
export function crossfaderPositionForTransition(
  fromDeck: DeckId,
  style: TransitionStyle,
  progress: number,
): number {
  const clamped = clamp(progress, 0, 1);
  const t = style === "cut" ? (clamped > 0 ? 1 : 0) : clamped;
  return fromDeck === "a" ? t : 1 - t;
}

/**
 * Bass Swap's low-EQ kill state at a given transition progress: the
 * incoming deck's bass stays killed (so it doesn't clash under the
 * outgoing track) until the transition's midpoint, at which point the
 * outgoing deck's bass is killed instead and the incoming deck's bass is
 * restored — the classic DJ "bass swap" hand-off.
 */
export function bassSwapKillState(progress: number): {
  readonly outgoingLowKilled: boolean;
  readonly incomingLowKilled: boolean;
} {
  const pastMidpoint = clamp(progress, 0, 1) >= 0.5;
  return { outgoingLowKilled: pastMidpoint, incomingLowKilled: !pastMidpoint };
}

interface TransitionRuntime {
  readonly fromDeck: DeckId;
  readonly toDeck: DeckId;
  readonly startedAtMs: number;
}

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let unsubscribeStore: (() => void) | null = null;
let runtime: TransitionRuntime | null = null;
let pendingLoad = false;
let pendingBootstrap = false;

async function loadEntryIntoDeck(deck: DeckId, entry: AutomixQueueEntry): Promise<void> {
  const { metadata, audioBuffer, bytes } = await decodeTrack(entry.filePath, entry.fileName);
  deckStoreFor(deck).getState().loadTrack(metadata);
  deckEngineFor(getMasterGraph(), deck).loadBuffer(audioBuffer);
  analyzeTrackInBackground(deck, bytes, entry.filePath);
}

function resetTransitionEffects(deck: DeckId): void {
  deckEngineFor(getMasterGraph(), deck).setEchoWetLevel(0, 0);
  useMixerStore.getState().setEqKilled(deck, "low", false);
}

function applyTransitionProgress(progress: number): void {
  if (runtime === null) return;
  const { fromDeck, toDeck } = runtime;
  const style = useAutomixStore.getState().transitionStyle;

  useMixerStore
    .getState()
    .setCrossfaderPosition(crossfaderPositionForTransition(fromDeck, style, progress));

  if (style === "bassSwap") {
    const swap = bassSwapKillState(progress);
    useMixerStore.getState().setEqKilled(fromDeck, "low", swap.outgoingLowKilled);
    useMixerStore.getState().setEqKilled(toDeck, "low", swap.incomingLowKilled);
  } else if (style === "echoOut") {
    deckEngineFor(getMasterGraph(), fromDeck).setEchoWetLevel(progress, 0.1);
  }
}

function finishTransition(): void {
  if (runtime === null) return;
  const { fromDeck, toDeck } = runtime;
  const engine = getMasterGraph();
  deckEngineFor(engine, fromDeck).stop();
  deckStoreFor(fromDeck).getState().stop();
  resetTransitionEffects(fromDeck);
  resetTransitionEffects(toDeck);
  useAutomixStore.getState().setActiveDeck(toDeck);
  runtime = null;
}

function beginTransition(fromDeck: DeckId, toDeck: DeckId): void {
  runtime = { fromDeck, toDeck, startedAtMs: Date.now() };
  const engine = getMasterGraph();
  deckEngineFor(engine, toDeck).play();
  deckStoreFor(toDeck).getState().play();
  applyTransitionProgress(0);
}

async function bootstrapFirstTrack(): Promise<void> {
  if (pendingBootstrap) return;
  const first = useAutomixStore.getState().queue[0];
  if (first === undefined) return;

  pendingBootstrap = true;
  try {
    await loadEntryIntoDeck("a", first);
    useAutomixStore.getState().removeFromQueue(first.id);
    useMixerStore.getState().setCrossfaderPosition(0);
    deckEngineFor(getMasterGraph(), "a").play();
    deckStoreFor("a").getState().play();
    useAutomixStore.getState().setActiveDeck("a");
  } catch (error) {
    console.error(`Automix failed to load "${first.fileName}":`, error);
  } finally {
    pendingBootstrap = false;
  }
}

async function startTransitionToNext(activeDeck: DeckId, entry: AutomixQueueEntry): Promise<void> {
  if (pendingLoad) return;
  pendingLoad = true;
  const toDeck = otherDeck(activeDeck);
  try {
    await loadEntryIntoDeck(toDeck, entry);
    useAutomixStore.getState().removeFromQueue(entry.id);
    beginTransition(activeDeck, toDeck);
  } catch (error) {
    console.error(`Automix failed to load "${entry.fileName}":`, error);
  } finally {
    pendingLoad = false;
  }
}

/** Dead-air fallback (Phase 3.5's silenceWatchdog): hard-cut to the next queued track immediately. */
function handleSilenceDetected(): void {
  const automix = useAutomixStore.getState();
  if (automix.status !== "running" || runtime !== null || pendingLoad) return;
  const activeDeck = automix.activeDeck;
  if (activeDeck === null) return;
  const nextEntry = automix.queue[0];
  if (nextEntry === undefined) return;

  const toDeck = otherDeck(activeDeck);
  pendingLoad = true;
  void loadEntryIntoDeck(toDeck, nextEntry)
    .then(() => {
      useAutomixStore.getState().removeFromQueue(nextEntry.id);
      const engine = getMasterGraph();
      useMixerStore.getState().setCrossfaderPosition(toDeck === "a" ? 0 : 1);
      deckEngineFor(engine, toDeck).play();
      deckStoreFor(toDeck).getState().play();
      deckEngineFor(engine, activeDeck).stop();
      deckStoreFor(activeDeck).getState().stop();
      useAutomixStore.getState().setActiveDeck(toDeck);
    })
    .catch((error: unknown) => {
      console.error("Automix silence fallback failed:", error);
    })
    .finally(() => {
      pendingLoad = false;
    });
}

function pollTick(): void {
  const automix = useAutomixStore.getState();
  if (automix.status !== "running") return;

  if (runtime !== null) {
    const elapsedSeconds = (Date.now() - runtime.startedAtMs) / 1000;
    const progress = elapsedSeconds / Math.max(automix.transitionSeconds, 0.01);
    applyTransitionProgress(progress);
    if (progress >= 1) finishTransition();
    return;
  }

  const activeDeck = automix.activeDeck;
  if (activeDeck === null) {
    void bootstrapFirstTrack();
    return;
  }

  const engine = deckEngineFor(getMasterGraph(), activeDeck);
  const duration = deckStoreFor(activeDeck).getState().track?.duration ?? 0;

  if (shouldStartTransition(engine.getCurrentTime(), duration, automix.triggerSecondsBeforeEnd)) {
    const nextEntry = automix.queue[0];
    if (nextEntry === undefined) return; // nothing queued — let the current track play out
    void startTransitionToNext(activeDeck, nextEntry);
  }
}

function resetRuntime(): void {
  if (runtime !== null) {
    resetTransitionEffects(runtime.fromDeck);
    resetTransitionEffects(runtime.toDeck);
  }
  runtime = null;
  pendingLoad = false;
  pendingBootstrap = false;
}

/**
 * Starts the automix poll loop and dead-air fallback for the lifetime of
 * the app. Call once (e.g. from App.tsx's mount effect); returns a cleanup
 * function. Safe to call before the shared AudioContext has resumed — the
 * poll loop itself is a no-op until useAutomixStore's status is "running",
 * which only happens after a user gesture has started playback anyway.
 */
export function initAutomixController(): () => void {
  getAudioContext(); // ensure the singleton exists before touching the master graph
  const graph = getMasterGraph();
  graph.silenceWatchdog.start(handleSilenceDetected);
  pollIntervalId = setInterval(pollTick, POLL_INTERVAL_MS);

  unsubscribeStore = useAutomixStore.subscribe((state, prevState) => {
    if (state.status === "idle" && prevState.status !== "idle") {
      resetRuntime();
    }
  });

  return () => {
    if (pollIntervalId !== null) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    graph.silenceWatchdog.stop();
    unsubscribeStore?.();
    unsubscribeStore = null;
    resetRuntime();
  };
}
