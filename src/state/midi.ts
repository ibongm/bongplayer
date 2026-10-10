// The DDJ-400 seen from the screen: knobs moved on the controller move the knobs here, LOAD
// and the browse knob work on the track table, refusals become notices.

import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isRecord } from "../ipc/guards";
import type { DeckName } from "../ipc/types";
import { browser, loadToDeck, notify, setSelection, visibleRows } from "./app";
import { moveFocus } from "./selection";
import { mixer, type ChannelState } from "./ui";

const CHANNEL_KEYS = ["trim", "high", "mid", "low", "filter", "fader"] as const;
type ChannelKey = (typeof CHANNEL_KEYS)[number];

function isDeck(v: unknown): v is DeckName {
  return v === "A" || v === "B";
}

function isChannelKey(v: unknown): v is ChannelKey & keyof ChannelState {
  return typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
}

/** Applies one controller event (sent by Rust as the "midi" event). */
export function handleMidiEvent(ev: unknown): void {
  if (!isRecord(ev) || typeof ev.type !== "string") return;
  switch (ev.type) {
    case "mixer": {
      const { deck, key, value } = ev;
      if (typeof value !== "number") return;
      // The engine already has the value; only the screen follows.
      if (key === "crossfader") mixer.set((m) => ({ ...m, crossfader: value }));
      else if (isDeck(deck) && isChannelKey(key)) {
        mixer.set((m) => ({ ...m, [deck]: { ...m[deck], [key]: value } }));
      }
      return;
    }
    case "load": {
      if (!isDeck(ev.deck)) return;
      const s = browser.get();
      const rows = visibleRows(s);
      const row = s.selection.focus === null ? undefined : rows[s.selection.focus];
      if (row) void loadToDeck(ev.deck, row.track.id);
      else notify("error", `LOAD ${ev.deck}: select a track in the list first (turn the browse knob)`);
      return;
    }
    case "browse": {
      if (typeof ev.steps !== "number") return;
      const s = browser.get();
      const order = visibleRows(s).map((r) => r.key);
      if (order.length === 0) return;
      setSelection(moveFocus(s.selection, order, ev.steps, false));
      return;
    }
    case "notice":
      if (typeof ev.text === "string") notify("error", ev.text);
      return;
  }
}

export async function startMidiFeed(): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  return listen("midi", (e) => {
    handleMidiEvent(e.payload);
  });
}
