// Shared UI state and the actions that change it. Every backend call goes through `run()`,
// which turns failures into a visible message instead of a silent no-op.

import { backend } from "../ipc/backend";
import type {
  CrateInfo,
  CrateKind,
  DeckName,
  IpcResult,
  QueueEntry,
  ScanStats,
  StatusSnapshot,
  TrackRow,
} from "../ipc/types";
import { emptySelection, prune, type Selection } from "./selection";
import { createStore } from "./store";

// ----- messages -----

export interface Notice {
  id: number;
  kind: "error" | "info";
  text: string;
}

export const notices = createStore<Notice[]>([]);
let nextNotice = 1;

export function notify(kind: Notice["kind"], text: string): void {
  const id = nextNotice++;
  notices.set((list) => [...list.slice(-4), { id, kind, text }]);
  if (kind === "info") {
    setTimeout(() => {
      dismiss(id);
    }, 5000);
  }
}

export function dismiss(id: number): void {
  notices.set((list) => list.filter((n) => n.id !== id));
}

/** Unwraps a backend result; on failure shows the error and returns `null`. */
export function run<T>(result: IpcResult<T>, context?: string): T | null {
  if (result.ok) return result.value;
  notify("error", context ? `${context}: ${result.error}` : result.error);
  return null;
}

// ----- track browser (middle column) -----

export type Source =
  | { kind: "folder"; path: string }
  | { kind: "library" }
  | { kind: "crate"; id: number; name: string; crateKind: CrateKind };

export interface TableRow {
  /** Unique within the table (a playlist may contain a track twice). */
  key: string;
  track: TrackRow;
  /** Position inside a crate / playlist. */
  position?: number;
}

export interface BrowserState {
  source: Source | null;
  rows: TableRow[];
  loading: boolean;
  error: string | null;
  search: string;
  selection: Selection;
  stats: ScanStats | null;
}

export const browser = createStore<BrowserState>({
  source: null,
  rows: [],
  loading: false,
  error: null,
  search: "",
  selection: emptySelection,
  stats: null,
});

export function sourceLabel(s: Source | null): string {
  if (s === null) return "Nothing open";
  switch (s.kind) {
    case "folder":
      return s.path;
    case "library":
      return "Music Library";
    case "crate":
      return s.name;
  }
}

function matches(row: TableRow, q: string): boolean {
  const t = row.track;
  return [t.title, t.artist, t.album, t.remix, t.genre, t.key ?? ""].some((f) =>
    f.toLowerCase().includes(q),
  );
}

/** Rows after the search filter, in display order. */
export function visibleRows(state: BrowserState): TableRow[] {
  const q = state.search.trim().toLowerCase();
  return q === "" ? state.rows : state.rows.filter((r) => matches(r, q));
}

let loadToken = 0;

/** Opens a source. The current rows stay on screen until the new ones have arrived. */
export async function openSource(source: Source): Promise<void> {
  const token = ++loadToken;
  browser.set((s) => ({ ...s, source, loading: true, error: null }));
  const b = backend();
  let rows: TableRow[] | null = null;
  let stats: ScanStats | null = null;
  let error: string | null = null;
  if (source.kind === "folder") {
    const r = await b.folderTracks(source.path);
    if (r.ok) {
      rows = r.value.rows.map((t) => ({ key: `t${t.id}`, track: t }));
      stats = r.value.stats;
    } else error = r.error;
  } else if (source.kind === "library") {
    const r = await b.libraryTracks();
    if (r.ok) rows = r.value.map((t) => ({ key: `t${t.id}`, track: t }));
    else error = r.error;
  } else {
    const r = await b.crateTracks(source.id);
    if (r.ok) {
      rows = r.value.map((e) => ({ key: `p${e.position}`, track: e.track, position: e.position }));
    } else error = r.error;
  }
  if (token !== loadToken) return; // a newer request won
  browser.set((s) => {
    if (rows === null) return { ...s, loading: false, error };
    const sameSource = JSON.stringify(s.source) === JSON.stringify(source);
    const selection = sameSource ? prune(s.selection, rows.map((r) => r.key)) : emptySelection;
    return { ...s, rows, stats, loading: false, error: null, selection };
  });
}

/** Re-reads the current source after a change, keeping rows and selection on screen. */
export async function refresh(): Promise<void> {
  const src = browser.get().source;
  if (src) await openSource(src);
}

export function setSearch(search: string): void {
  browser.set((s) => ({ ...s, search, selection: emptySelection }));
}

export function setSelection(selection: Selection): void {
  browser.set((s) => ({ ...s, selection }));
}

// ----- crates & playlists -----

export const crates = createStore<CrateInfo[]>([]);

export async function refreshCrates(): Promise<void> {
  const list = run(await backend().cratesList(), "Crates");
  if (list) crates.set(list);
}

export async function createCrate(name: string, kind: CrateKind): Promise<number | null> {
  const id = run(await backend().crateCreate(name, kind), `Create ${kind}`);
  await refreshCrates();
  return id;
}

export async function addToCrate(id: number, trackIds: number[]): Promise<void> {
  const added = run(await backend().crateAdd(id, trackIds), "Add to crate");
  if (added !== null) {
    const name = crates.get().find((c) => c.id === id)?.name ?? "crate";
    notify("info", `${added} of ${trackIds.length} track(s) added to “${name}”`);
  }
  await refreshCrates();
  const src = browser.get().source;
  if (src?.kind === "crate" && src.id === id) await refresh();
}

// ----- Automix queue -----

export const queue = createStore<QueueEntry[]>([]);

export function setQueue(result: IpcResult<QueueEntry[]>, context: string): void {
  const entries = run(result, context);
  if (entries) queue.set(entries);
}

export async function refreshQueue(): Promise<void> {
  setQueue(await backend().queueList(), "Automix queue");
}

export async function enqueue(trackIds: number[], before: number | null = null): Promise<void> {
  setQueue(await backend().queueAdd(trackIds, before), "Add to Automix");
  notify("info", `${trackIds.length} track(s) added to Automix`);
}

// ----- decks -----

export async function loadToDeck(deck: DeckName, trackId: number): Promise<void> {
  run(await backend().deckLoad(deck, trackId), `Load to deck ${deck}`);
}

// ----- live engine status (~60 Hz) -----
// Kept outside React state: canvases and refs read it every frame; components that show
// slow-changing parts (title, loaded) subscribe through `useStore` with a selector.

export const status = createStore<StatusSnapshot | null>(null);
