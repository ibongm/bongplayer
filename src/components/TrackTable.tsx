// The track table: virtualised (only visible rows exist in the page), multi-select with
// mouse and keyboard, hover buttons per row, right-click menu, and drag-out to decks, the
// Automix queue and crates.

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { startPointerDrag, type DragPayload } from "../dnd/drag";
import { backend } from "../ipc/backend";
import type { TrackRow } from "../ipc/types";
import {
  browser,
  enqueue,
  loadToDeck,
  notify,
  openSource,
  refresh,
  run,
  setSearch,
  setSelection,
  sourceLabel,
  visibleRows,
  type TableRow,
} from "../state/app";
import {
  clickRow,
  emptySelection,
  type Selection,
  moveFocus,
  selectAll,
  selectedInOrder,
} from "../state/selection";
import { createStore, useStore } from "../state/store";
import { trackMenu } from "../state/trackActions";
import { openMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";

export const ROW_HEIGHT = 28;
const OVERSCAN = 8;

export type ColumnId =
  | "cover"
  | "title"
  | "artist"
  | "remix"
  | "album"
  | "genre"
  | "year"
  | "length"
  | "bpm"
  | "key"
  | "plays"
  | "lastPlayed"
  | "rating";

interface Column {
  id: ColumnId;
  label: string;
  width: string;
  align?: "right";
  value: (t: TrackRow) => string;
  /** Draws the cell instead of the text value. */
  render?: (t: TrackRow) => ReactNode;
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function formatDate(unix: number | null): string {
  if (unix === null) return "";
  return new Date(unix * 1000).toLocaleDateString();
}

export const COLUMNS: Column[] = [
  {
    id: "cover",
    label: "Cover",
    width: "30px",
    value: () => "",
    render: (t) => (t.hasCover ? <Cover trackId={t.id} size={24} /> : null),
  },
  { id: "title", label: "Title", width: "minmax(90px,3fr)", value: (t) => t.title },
  { id: "artist", label: "Artist", width: "minmax(70px,2fr)", value: (t) => t.artist },
  { id: "remix", label: "Remix", width: "minmax(50px,1.2fr)", value: (t) => t.remix },
  { id: "album", label: "Album", width: "minmax(60px,1.5fr)", value: (t) => t.album },
  { id: "genre", label: "Genre", width: "100px", value: (t) => t.genre },
  { id: "year", label: "Year", width: "56px", align: "right", value: (t) => (t.year === null ? "" : String(t.year)) },
  {
    id: "length",
    label: "Length",
    width: "64px",
    align: "right",
    value: (t) => formatTime(t.durationMs === null ? null : t.durationMs / 1000),
  },
  {
    id: "bpm",
    label: "BPM",
    width: "64px",
    align: "right",
    value: (t) => (t.bpm === null ? "" : `${t.bpm.toFixed(1)}${t.bpmIsManual ? "*" : ""}`),
  },
  { id: "key", label: "Key", width: "48px", value: (t) => t.key ?? "" },
  { id: "plays", label: "Plays", width: "52px", align: "right", value: (t) => (t.playCount > 0 ? String(t.playCount) : "") },
  { id: "lastPlayed", label: "Last played", width: "96px", value: (t) => formatDate(t.lastPlayed) },
  { id: "rating", label: "Rating", width: "70px", value: (t) => "★".repeat(t.rating) },
];

export const DEFAULT_COLUMNS: ColumnId[] = [
  "cover",
  "title",
  "artist",
  "remix",
  "length",
  "bpm",
  "key",
  "plays",
  "lastPlayed",
];

const COLUMNS_SETTING = "table.columns";

/** Columns shown in the track table (header right-click or Settings → Library). */
export const tableColumns = createStore<ColumnId[]>(DEFAULT_COLUMNS);

export async function loadTableColumns(): Promise<void> {
  const r = await backend().settingGet(COLUMNS_SETTING);
  if (!r.ok || r.value === null) return;
  try {
    const parsed: unknown = JSON.parse(r.value);
    if (Array.isArray(parsed) && parsed.every(isColumnId) && parsed.length > 0) tableColumns.set(parsed);
  } catch {
    // A broken setting falls back to the default columns.
  }
}

/** Shows or hides a column (at least one stays) and saves the layout. */
export function toggleColumn(id: ColumnId): void {
  const columns = tableColumns.get();
  const next = columns.includes(id)
    ? columns.filter((c) => c !== id)
    : COLUMNS.map((c) => c.id).filter((c) => c === id || columns.includes(c));
  if (next.length === 0) return;
  tableColumns.set(next);
  void backend().settingSet(COLUMNS_SETTING, JSON.stringify(next));
}

function isColumnId(v: unknown): v is ColumnId {
  return typeof v === "string" && COLUMNS.some((c) => c.id === v);
}

function dragPayload(rows: TableRow[]): DragPayload | null {
  if (rows.length === 0) return null;
  const first = rows[0]?.track;
  const label =
    rows.length === 1 && first ? `${first.artist ? `${first.artist} – ` : ""}${first.title}` : `${rows.length} tracks`;
  return { kind: "tracks", trackIds: rows.map((r) => r.track.id), label };
}

export function TrackTable(): ReactNode {
  const state = useStore(browser, (s) => s);
  const rows = useMemo(() => visibleRows(state), [state]);
  const order = useMemo(() => rows.map((r) => r.key), [rows]);
  const selection = state.selection;
  const columns = useStore(tableColumns, (c) => c);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  // Column layout is a saved setting.
  useEffect(() => {
    void loadTableColumns();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewHeight(el.clientHeight || 600);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setViewHeight(el.clientHeight || 600);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const cols = COLUMNS.filter((c) => columns.includes(c.id));
  const template = cols.map((c) => c.width).join(" ");
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);

  const selectedRows = useCallback(
    (): TableRow[] => {
      const keys = new Set(selectedInOrder(browser.get().selection, order));
      return rows.filter((r) => keys.has(r.key));
    },
    [order, rows],
  );

  const focusedRow = (): TableRow | undefined => {
    const f = browser.get().selection.focus;
    return f === null ? undefined : rows[f];
  };

  const scrollIntoView = (index: number | null): void => {
    const el = scrollRef.current;
    if (!el || index === null) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  };

  const showMenu = (x: number, y: number): void => {
    const sel = selectedRows();
    const focused = focusedRow() ?? sel[0];
    if (!focused || sel.length === 0) return;
    openMenu(x, y, trackMenu({ selected: sel, focused }));
  };

  const headerMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    const items: MenuItem[] = COLUMNS.map((c) => ({
      id: `col-${c.id}`,
      label: `${columns.includes(c.id) ? "✓" : "  "} ${c.label}`,
      onSelect: () => {
        toggleColumn(c.id);
      },
    }));
    openMenu(e.clientX, e.clientY, items);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey;
    const sel = browser.get().selection;
    let next: Selection;
    const page = Math.max(1, Math.floor(viewHeight / ROW_HEIGHT) - 1);
    switch (e.key) {
      case "ArrowDown":
        next = moveFocus(sel, order, 1, e.shiftKey);
        break;
      case "ArrowUp":
        next = moveFocus(sel, order, -1, e.shiftKey);
        break;
      case "PageDown":
        next = moveFocus(sel, order, page, e.shiftKey);
        break;
      case "PageUp":
        next = moveFocus(sel, order, -page, e.shiftKey);
        break;
      case "Home":
        next = moveFocus(sel, order, -order.length, e.shiftKey);
        break;
      case "End":
        next = moveFocus(sel, order, order.length, e.shiftKey);
        break;
      case "a":
      case "A":
        if (!ctrl) return;
        next = selectAll(order);
        break;
      case "Escape":
        next = emptySelection;
        break;
      case "Enter": {
        const f = focusedRow();
        if (f) void loadToDeck(e.shiftKey ? "B" : "A", f.track.id);
        e.preventDefault();
        return;
      }
      case "q":
      case "Q": {
        const ids = selectedRows().map((r) => r.track.id);
        if (ids.length > 0) void enqueue(ids);
        e.preventDefault();
        return;
      }
      case "Delete": {
        // The menu's remove action (crate or library) asks for confirmation where needed.
        const sel2 = selectedRows();
        const f = focusedRow() ?? sel2[0];
        if (!f) return;
        const remove = trackMenu({ selected: sel2, focused: f }).find(
          (i) => i.id === "remove-from-crate" || i.id === "remove",
        );
        remove?.onSelect?.();
        e.preventDefault();
        return;
      }
      case "ContextMenu":
      case "F10": {
        if (e.key === "F10" && !e.shiftKey) return;
        const f = browser.get().selection.focus;
        const rect = scrollRef.current?.getBoundingClientRect();
        if (f !== null && rect) {
          showMenu(rect.left + 40, rect.top + (f + 1) * ROW_HEIGHT - (scrollRef.current?.scrollTop ?? 0));
        }
        e.preventDefault();
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    setSelection(next);
    scrollIntoView(next.focus);
  };

  const onRowPointerDown = (e: React.PointerEvent, index: number, row: TableRow): void => {
    if (e.button !== 0) return;
    const sel = browser.get().selection;
    // Dragging a row that is not selected drags just that row.
    if (!sel.keys.has(row.key) && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      setSelection(clickRow(sel, order, index, { ctrl: false, shift: false }));
    }
    startPointerDrag(e, () => dragPayload(selectedRows()));
  };

  const analyzeVisible = async (): Promise<void> => {
    const sel = selectedRows();
    const target = sel.length > 0 ? sel : rows;
    if (target.length === 0) return;
    notify("info", `Analyzing ${target.length} track(s)…`);
    const rep = run(await backend().analyzeTracks(target.map((r) => r.track.id)), "Analyze");
    if (rep) notify("info", `Analyzed ${rep.analyzed} track(s) in ${rep.seconds.toFixed(1)} s`);
    await refresh();
  };

  const importFiles = async (): Promise<void> => {
    if (!isTauri()) {
      notify("error", "Importing files needs the desktop app");
      return;
    }
    const picked = await openFileDialog({
      multiple: true,
      title: "Import audio files",
      filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "m4a", "aac", "ogg"] }],
    });
    if (!picked || picked.length === 0) return;
    const r = run(await backend().importPaths(picked), "Import");
    if (r) {
      notify("info", `Imported ${r.length} track(s) into the Music Library`);
      await openSource({ kind: "library" });
    }
  };

  const focusIndex = selection.focus;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || focusIndex === null) return;
    const top = focusIndex * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight && el.clientHeight > 0) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  }, [focusIndex]);

  const selCount = selection.keys.size;

  return (
    <section aria-label="Tracks" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <input
          type="search"
          aria-label="Search tracks"
          placeholder="Search title, artist, album, key… (Ctrl+F)"
          title="Search the open list (Ctrl+F)"
          data-shortcut="ctrl+f"
          value={state.search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-[13px]"
        />
        <button
          type="button"
          className="rounded px-2 py-1 text-[12px] hover:bg-surface-raised"
          title="Analyze BPM & key of the selected tracks, or of all tracks in the list"
          onClick={() => void analyzeVisible()}
        >
          Analyze
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-[12px] hover:bg-surface-raised"
          title="Import audio files into the Music Library"
          onClick={() => void importFiles()}
        >
          Import
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-[12px] hover:bg-surface-raised"
          aria-label="Clear search"
          title="Clear the search"
          onClick={() => {
            setSearch("");
          }}
        >
          Clear
        </button>
      </div>

      <div
        role="row"
        className="grid shrink-0 border-b border-border bg-surface px-2 text-[11px] font-semibold uppercase tracking-wide text-muted"
        style={{ gridTemplateColumns: template }}
        title="Right-click to choose columns"
        onContextMenu={headerMenu}
      >
        {cols.map((c) => (
          <div key={c.id} role="columnheader" aria-label={c.label} className={`truncate py-1.5 ${c.align === "right" ? "pr-2 text-right" : "pr-2"}`}>
            {c.render ? "" : c.label}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        role="grid"
        aria-label={`Tracks in ${sourceLabel(state.source)}`}
        aria-multiselectable="true"
        aria-rowcount={rows.length}
        tabIndex={0}
        title="↑/↓ move · Shift extends · Ctrl+A all · Esc none · Enter → Deck A · Shift+Enter → Deck B · Q → Automix · Del remove · Shift+F10 menu"
        className="relative min-h-0 flex-1 overflow-y-auto outline-none"
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          {rows.slice(first, last).map((row, i) => {
            const index = first + i;
            const selected = selection.keys.has(row.key);
            const focused = selection.focus === index;
            return (
              <div
                key={row.key}
                role="row"
                aria-selected={selected}
                aria-rowindex={index + 1}
                data-row-key={row.key}
                className={`group absolute right-0 left-0 grid cursor-default items-center px-2 text-[13px] ${
                  selected ? "bg-accent/25" : index % 2 === 1 ? "bg-surface/40" : ""
                } ${focused ? "outline outline-1 outline-accent/60" : ""} ${row.track.missing ? "text-muted line-through" : ""}`}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: template }}
                onPointerDown={(e) => {
                  onRowPointerDown(e, index, row);
                }}
                onClick={(e) => {
                  setSelection(clickRow(browser.get().selection, order, index, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
                }}
                onDoubleClick={() => void loadToDeck("A", row.track.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const sel = browser.get().selection;
                  if (!sel.keys.has(row.key)) {
                    setSelection(clickRow(sel, order, index, { ctrl: false, shift: false }));
                  } else {
                    setSelection({ ...sel, focus: index });
                  }
                  showMenu(e.clientX, e.clientY);
                }}
              >
                {cols.map((c) => (
                  <div key={c.id} role="gridcell" className={`truncate pr-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                    {c.render ? c.render(row.track) : c.value(row.track)}
                  </div>
                ))}
                <div className="absolute top-0.5 right-1 hidden gap-0.5 group-hover:flex" onPointerDown={(e) => { e.stopPropagation(); }}>
                  <RowButton label="A" title="Load to Deck A (Enter)" onClick={() => void loadToDeck("A", row.track.id)} />
                  <RowButton label="B" title="Load to Deck B (Shift+Enter)" onClick={() => void loadToDeck("B", row.track.id)} />
                  <RowButton label="⚡" title="Add to Automix (Q)" onClick={() => void enqueue([row.track.id])} />
                  <RowButton
                    label="⋮"
                    title="More actions (right-click, Shift+F10)"
                    onClick={(e) => {
                      const sel = browser.get().selection;
                      if (!sel.keys.has(row.key)) setSelection(clickRow(sel, order, index, { ctrl: false, shift: false }));
                      showMenu(e.clientX, e.clientY);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && !state.loading && (
          <p className="p-4 text-[13px] text-muted">
            {state.error
              ? null
              : state.source === null
                ? "Open a folder, the Music Library or a crate on the left."
                : state.search
                  ? "No tracks match the search."
                  : "No audio files here."}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border px-2 py-1 text-[11px] text-muted" aria-live="polite">
        <span data-testid="track-count">{rows.length} track{rows.length === 1 ? "" : "s"}</span>
        <span data-testid="selection-count">{selCount > 0 ? `${selCount} selected` : ""}</span>
        <span className="min-w-0 flex-1 truncate" title={sourceLabel(state.source)}>
          {sourceLabel(state.source)}
        </span>
        {state.loading && <span>Loading…</span>}
        {state.error && (
          <span role="alert" className="text-danger">
            {state.error}
          </span>
        )}
      </div>
    </section>
  );
}

function RowButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      className="h-6 min-w-6 rounded bg-surface-raised px-1 text-[12px] hover:bg-accent hover:text-bg"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
    >
      {label}
    </button>
  );
}
