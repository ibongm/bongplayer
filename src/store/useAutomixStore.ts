import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DeckId } from "../types/deck";

export type AutomixStatus = "idle" | "running" | "paused";

/** Matches ImplementationPlan.md Phase 7's transition styles. */
export type TransitionStyle = "smooth" | "bassSwap" | "cut" | "echoOut";

const DEFAULT_TRANSITION_SECONDS = 8;
const DEFAULT_TRIGGER_SECONDS_BEFORE_END = 15;

export interface AutomixQueueEntry {
  readonly id: string;
  readonly filePath: string;
  readonly fileName: string;
  /** Populated asynchronously after enqueue (see setEntryDuration) — null until then. */
  readonly durationSeconds: number | null;
}

export interface AutomixState {
  readonly queue: readonly AutomixQueueEntry[];
  readonly status: AutomixStatus;
  readonly activeDeck: DeckId | null;
  readonly transitionStyle: TransitionStyle;
  readonly transitionSeconds: number;
  readonly triggerSecondsBeforeEnd: number;

  enqueue(entry: Omit<AutomixQueueEntry, "id" | "durationSeconds">): void;
  setEntryDuration(id: string, durationSeconds: number): void;
  removeFromQueue(id: string): void;
  moveToTop(id: string): void;
  moveToBottom(id: string): void;
  clearQueue(): void;
  start(): void;
  pause(): void;
  stop(): void;
  setActiveDeck(deck: DeckId | null): void;
  setTransitionStyle(style: TransitionStyle): void;
  setTransitionSeconds(seconds: number): void;
  setTriggerThreshold(seconds: number): void;
}

function moveEntry(
  queue: readonly AutomixQueueEntry[],
  id: string,
  position: "top" | "bottom",
): readonly AutomixQueueEntry[] {
  const entry = queue.find((item) => item.id === id);
  if (entry === undefined) return queue;
  const rest = queue.filter((item) => item.id !== id);
  return position === "top" ? [entry, ...rest] : [...rest, entry];
}

export const useAutomixStore = create<AutomixState>()(
  devtools(
    (set) => ({
      queue: [],
      status: "idle",
      activeDeck: null,
      transitionStyle: "smooth",
      transitionSeconds: DEFAULT_TRANSITION_SECONDS,
      triggerSecondsBeforeEnd: DEFAULT_TRIGGER_SECONDS_BEFORE_END,

      enqueue(entry) {
        set(
          (state) => ({
            queue: [...state.queue, { ...entry, id: crypto.randomUUID(), durationSeconds: null }],
          }),
          false,
          "enqueue",
        );
      },

      setEntryDuration(id, durationSeconds) {
        set(
          (state) => ({
            queue: state.queue.map((entry) =>
              entry.id === id ? { ...entry, durationSeconds } : entry,
            ),
          }),
          false,
          "setEntryDuration",
        );
      },

      removeFromQueue(id) {
        set(
          (state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }),
          false,
          "removeFromQueue",
        );
      },

      moveToTop(id) {
        set((state) => ({ queue: moveEntry(state.queue, id, "top") }), false, "moveToTop");
      },

      moveToBottom(id) {
        set((state) => ({ queue: moveEntry(state.queue, id, "bottom") }), false, "moveToBottom");
      },

      clearQueue() {
        set({ queue: [] }, false, "clearQueue");
      },

      start() {
        set({ status: "running" }, false, "start");
      },

      pause() {
        set({ status: "paused" }, false, "pause");
      },

      stop() {
        set({ status: "idle", activeDeck: null }, false, "stop");
      },

      setActiveDeck(deck) {
        set({ activeDeck: deck }, false, "setActiveDeck");
      },

      setTransitionStyle(style) {
        set({ transitionStyle: style }, false, "setTransitionStyle");
      },

      setTransitionSeconds(seconds) {
        set({ transitionSeconds: Math.max(0, seconds) }, false, "setTransitionSeconds");
      },

      setTriggerThreshold(seconds) {
        set({ triggerSecondsBeforeEnd: Math.max(0, seconds) }, false, "setTriggerThreshold");
      },
    }),
    { name: "automix" },
  ),
);
