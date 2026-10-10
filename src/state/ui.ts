// UI state that is not about the library: current view, mixer knob positions, waveform
// cache, and helpers for 60 fps drawing.

import { backend } from "../ipc/backend";
import type { DeckName, FxName, UiCommand, Waveform } from "../ipc/types";
import { notify, status } from "./app";
import { createStore } from "./store";

// ----- views -----

export type View = "standard" | "decks" | "library" | "day";
export const view = createStore<View>("standard");

export const settingsOpen = createStore(false);
/** Right column of the dock: the Automix queue or the selected track's info. */
export type DockTab = "automix" | "info";
export const dockTab = createStore<DockTab>("automix");

/** Settings key of the internet lookup switch ("1" = on). OFF unless the owner turns it on. */
export const INTERNET_LOOKUP_KEY = "internet.lookup";
/** The switch as last read (null = not read yet). */
export const internetLookup = createStore<boolean | null>(null);

export async function loadInternetLookup(): Promise<void> {
  const r = await backend().settingGet(INTERNET_LOOKUP_KEY);
  internetLookup.set(r.ok && r.value === "1");
}

export async function setInternetLookup(on: boolean): Promise<boolean> {
  const r = await backend().settingSet(INTERNET_LOOKUP_KEY, on ? "1" : "0");
  if (r.ok) internetLookup.set(on);
  return r.ok;
}

// ----- mixer -----
// The engine does not report knob positions back, so the UI keeps them and sends changes.

export interface ChannelState {
  trim: number;
  high: number;
  mid: number;
  low: number;
  killHigh: boolean;
  killMid: boolean;
  killLow: boolean;
  filter: number;
  fader: number;
  /** Deck effect and its STR / SPD knobs (0 … 1). */
  fx: FxName;
  fxStr: number;
  fxSpd: number;
}

export interface MixerState {
  A: ChannelState;
  B: ChannelState;
  crossfader: number;
  master: number;
  /** Headphones: 0 = cued decks only … 1 = master only. */
  cueMix: number;
}

export const channelDefaults: ChannelState = {
  trim: 0,
  high: 0,
  mid: 0,
  low: 0,
  killHigh: false,
  killMid: false,
  killLow: false,
  filter: 0,
  fader: 1,
  fx: "off",
  fxStr: 0.5,
  fxSpd: 0.5,
};

export const mixer = createStore<MixerState>({
  A: { ...channelDefaults },
  B: { ...channelDefaults },
  crossfader: 0.5,
  master: 0,
  cueMix: 0,
});

/** Sends an engine command; shows the error if it fails. Returns whether it worked. */
export async function send(command: UiCommand, context?: string): Promise<boolean> {
  const r = await backend().engineCommand(command);
  if (!r.ok) notify("error", context ? `${context}: ${r.error}` : r.error);
  return r.ok;
}

export function setChannel<K extends keyof ChannelState>(
  deck: DeckName,
  key: K,
  value: ChannelState[K],
): void {
  mixer.set((m) => ({ ...m, [deck]: { ...m[deck], [key]: value } }));
  const ch = { ...mixer.get()[deck] };
  switch (key) {
    case "trim":
      void send({ type: "trim", deck, db: ch.trim });
      break;
    case "high":
      void send({ type: "eq", deck, band: "high", db: ch.high });
      break;
    case "mid":
      void send({ type: "eq", deck, band: "mid", db: ch.mid });
      break;
    case "low":
      void send({ type: "eq", deck, band: "low", db: ch.low });
      break;
    case "killHigh":
      void send({ type: "kill", deck, band: "high", on: ch.killHigh });
      break;
    case "killMid":
      void send({ type: "kill", deck, band: "mid", on: ch.killMid });
      break;
    case "killLow":
      void send({ type: "kill", deck, band: "low", on: ch.killLow });
      break;
    case "filter":
      void send({ type: "filter", deck, value: ch.filter });
      break;
    case "fader":
      void send({ type: "fader", deck, position: ch.fader });
      break;
    case "fx":
      void send({ type: "fx", deck, kind: ch.fx }, `Effect deck ${deck}`);
      void send({ type: "fxParams", deck, strength: ch.fxStr, speed: ch.fxSpd });
      break;
    case "fxStr":
    case "fxSpd":
      void send({ type: "fxParams", deck, strength: ch.fxStr, speed: ch.fxSpd });
      break;
  }
}

export function setCrossfader(position: number): void {
  mixer.set((m) => ({ ...m, crossfader: position }));
  void send({ type: "crossfader", position });
}

export function setCueMix(mix: number): void {
  mixer.set((m) => ({ ...m, cueMix: mix }));
  void send({ type: "cueMix", mix }, "Headphones");
}

export function setMaster(db: number): void {
  mixer.set((m) => ({ ...m, master: db }));
  void send({ type: "master", db });
}

// ----- waveforms -----

export const waveforms = createStore<ReadonlyMap<number, Waveform>>(new Map());
const pending = new Set<number>();

/** Fetches a track's waveform once the status says it is ready. */
export async function ensureWaveform(trackId: number): Promise<void> {
  if (waveforms.get().has(trackId) || pending.has(trackId)) return;
  pending.add(trackId);
  const r = await backend().deckWaveform(trackId);
  pending.delete(trackId);
  if (r.ok) {
    waveforms.set((m) => {
      const next = new Map(m);
      // Keep only a handful of recent waveforms.
      if (next.size > 8) {
        const first = next.keys().next();
        if (!first.done) next.delete(first.value);
      }
      next.set(trackId, r.value);
      return next;
    });
  }
}

// ----- smooth positions for 60 fps drawing -----

let lastStatusAt = performance.now();
status.subscribe(() => {
  lastStatusAt = performance.now();
});

/** Deck position in seconds, extrapolated between status updates while playing. */
export function livePosition(index: 0 | 1): number {
  const d = status.get()?.decks[index];
  if (!d) return 0;
  if (!d.playing || d.scratching) return d.position;
  const dt = Math.min(0.1, (performance.now() - lastStatusAt) / 1000);
  const p = d.position + dt * d.tempo;
  return d.duration !== null ? Math.min(p, d.duration) : p;
}

// ----- one animation loop for every canvas -----

type Draw = (now: number) => void;
const drawers = new Set<Draw>();
let raf = 0;

function loop(now: number): void {
  drawers.forEach((d) => {
    d(now);
  });
  raf = drawers.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Registers a draw callback; returns the unregister function. */
export function onFrame(draw: Draw): () => void {
  drawers.add(draw);
  if (raf === 0) raf = requestAnimationFrame(loop);
  return () => {
    drawers.delete(draw);
  };
}

// ----- theme colours for canvases -----

let colorCache: { at: number; values: Map<string, string> } = { at: 0, values: new Map() };

/** Forgets the cached colours (a skin was switched; canvases redraw with the new ones). */
export function resetColorCache(): void {
  colorCache = { at: 0, values: new Map() };
}

/** Reads a CSS colour variable (cached for a second, so skins apply live). */
export function cssColor(name: string): string {
  const now = performance.now();
  if (now - colorCache.at > 1000) colorCache = { at: now, values: new Map() };
  let v = colorCache.values.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
    colorCache.values.set(name, v);
  }
  return v;
}

/** Prepares a canvas for crisp drawing at the screen's pixel density; null without 2D. */
export function context2d(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
