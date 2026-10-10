// The Automix queue: drop tracks / files / folders on it, reorder by dragging, select,
// remove, shuffle, clear. (Starting/stopping Automix and its settings arrive in M5.)

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { startPointerDrag } from "../dnd/drag";
import { backend } from "../ipc/backend";
import type { DeckName, QueueEntry } from "../ipc/types";
import { loadToDeck, notify, queue, refreshQueue, setQueue, status } from "../state/app";

/** Loads a queue entry (track or station) onto a deck. */
function loadEntry(deck: DeckName, e: QueueEntry): void {
  if (e.track.id < 0) {
    // Station entries carry -(station id) - 1 as their id.
    void backend()
      .deckLoadStation(deck, -e.track.id - 1)
      .then((r) => {
        if (!r.ok) notify("error", `Load to deck ${deck}: ${r.error}`);
      });
  } else void loadToDeck(deck, e.track.id);
}
import { clickRow, emptySelection, moveFocus, selectAll, selectedInOrder, type Selection } from "../state/selection";
import { useStore } from "../state/store";
import { openMenu } from "./ContextMenu";
import { AutomixCockpit } from "./AutomixCockpit";
import { confirmAction } from "./Dialog";
import { formatTime } from "./TrackTable";

export function AutomixPanel(): ReactNode {
  const entries = useStore(queue, (q) => q);
  const currentUid = useStore(status, (s) => s?.automix.currentUid ?? null);
  const nextUid = useStore(status, (s) => s?.automix.nextUid ?? null);
  const [sel, setSelState] = useState<Selection>(emptySelection);
  // Menus and drags read the latest selection, not the one from the last render.
  const selRef = useRef(sel);
  const setSel = (next: Selection): void => {
    selRef.current = next;
    setSelState(next);
  };
  const order = useMemo(() => entries.map((e) => String(e.uid)), [entries]);
  const totalSeconds = entries.reduce((s, e) => s + (e.track.durationMs ?? 0) / 1000, 0);

  useEffect(() => {
    void refreshQueue();
  }, []);

  const selectedUids = (): number[] => selectedInOrder(selRef.current, order).map(Number);

  const remove = async (uids: number[]): Promise<void> => {
    if (uids.length === 0) return;
    setQueue(await backend().queueRemove(uids), "Remove from Automix");
    setSel(emptySelection);
  };

  const clear = async (): Promise<void> => {
    if (entries.length === 0) return;
    const yes = await confirmAction("Clear Automix", `Remove all ${entries.length} tracks from the Automix queue?`, "Clear", true);
    if (!yes) return;
    setQueue(await backend().queueClear(), "Clear Automix");
    setSel(emptySelection);
  };

  const menu = (x: number, y: number, focusUid: number): void => {
    const uids = selectedUids();
    const n = uids.length;
    const focusEntry = entries.find((e) => e.uid === focusUid);
    const firstUid = entries[0]?.uid ?? null;
    openMenu(x, y, [
      {
        id: "load-a",
        label: n > 1 ? `Load “${focusEntry?.track.title ?? ""}” to Deck A` : "Load to Deck A",
        onSelect: () => {
          if (focusEntry) loadEntry("A", focusEntry);
        },
      },
      {
        id: "load-b",
        label: n > 1 ? `Load “${focusEntry?.track.title ?? ""}” to Deck B` : "Load to Deck B",
        onSelect: () => {
          if (focusEntry) loadEntry("B", focusEntry);
        },
      },
      {
        id: "top",
        label: `Move ${n} track(s) to the top`,
        separator: true,
        disabled: firstUid === null,
        onSelect: () =>
          void backend()
            .queueMove(uids, firstUid)
            .then((r) => {
              setQueue(r, "Move");
            }),
      },
      {
        id: "remove",
        label: `Remove ${n} track(s) from Automix`,
        shortcut: "Del",
        danger: true,
        onSelect: () => void remove(uids),
      },
    ]);
  };

  return (
    <section aria-label="Automix" className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <h2 className="flex-1 text-[12px] font-semibold uppercase tracking-wide">Automix</h2>
        <button type="button" aria-label="Clear Automix queue" className="rounded px-2 py-0.5 text-[12px] hover:bg-surface-raised" title="Remove every track from the queue" onClick={() => void clear()}>
          Clear
        </button>
      </div>
      <AutomixCockpit />

      <ol
        aria-label="Automix queue"
        data-drop="queue"
        tabIndex={0}
        title="Drop tracks, files or folders here · drag to reorder · ↑/↓ select · Ctrl+A all · Del remove · Shift+F10 menu"
        className="min-h-24 flex-1 overflow-y-auto outline-none data-[drop-active=true]:bg-accent/10"
        onKeyDown={(e) => {
          const ctrl = e.ctrlKey || e.metaKey;
          const sel = selRef.current;
          let next: Selection;
          if (e.key === "ArrowDown") next = moveFocus(sel, order, 1, e.shiftKey);
          else if (e.key === "ArrowUp") next = moveFocus(sel, order, -1, e.shiftKey);
          else if (ctrl && (e.key === "a" || e.key === "A")) next = selectAll(order);
          else if (e.key === "Escape") next = emptySelection;
          else if (e.key === "Delete") {
            void remove(selectedUids());
            e.preventDefault();
            return;
          } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            const f = sel.focus === null ? undefined : entries[sel.focus];
            const r = e.currentTarget.getBoundingClientRect();
            if (f) menu(r.left + 30, r.top + 30, f.uid);
            e.preventDefault();
            return;
          } else return;
          e.preventDefault();
          setSel(next);
        }}
      >
        {entries.length === 0 && (
          <li className="p-3 text-[12px] text-muted">Drop tracks here, or press Q / ⚡ in the track list.</li>
        )}
        {entries.map((e, i) => {
          const selected = sel.keys.has(String(e.uid));
          return (
            <li
              key={e.uid}
              data-drop="queue-item"
              data-drop-value={String(e.uid)}
              data-uid={e.uid}
              aria-selected={selected}
              className={`flex cursor-default items-center gap-2 border-t-2 border-transparent px-2 py-1 text-[13px] data-[drop-active=true]:border-accent ${
                selected ? "bg-accent/25" : e.uid === currentUid ? "bg-accent/15 font-semibold" : e.uid === nextUid ? "bg-surface-raised/60" : i % 2 === 1 ? "bg-surface/40" : ""
              }`}
              onPointerDown={(ev) => {
                if (ev.button !== 0) return;
                let cur = selRef.current;
                if (!cur.keys.has(String(e.uid)) && !ev.ctrlKey && !ev.shiftKey) {
                  cur = clickRow(cur, order, i, { ctrl: false, shift: false });
                  setSel(cur);
                }
                startPointerDrag(ev, () => {
                  const uids = selectedInOrder(cur, order).map(Number);
                  const tracks = entries.filter((x) => uids.includes(x.uid)).map((x) => x.track.id);
                  return { kind: "queue", uids, trackIds: tracks, label: `${uids.length} queued track(s)` };
                });
              }}
              onClick={(ev) => {
                setSel(clickRow(selRef.current, order, i, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey }));
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                if (!selRef.current.keys.has(String(e.uid))) {
                  setSel(clickRow(selRef.current, order, i, { ctrl: false, shift: false }));
                }
                menu(ev.clientX, ev.clientY, e.uid);
              }}
            >
              <span className="w-6 text-right text-[11px] text-muted tabular-nums">
                {e.uid === currentUid ? "▶" : e.uid === nextUid ? "›" : i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {e.track.artist ? `${e.track.artist} – ` : ""}
                {e.track.title}
              </span>
              <span className="text-[11px] text-muted tabular-nums">
                {formatTime(e.track.durationMs === null ? null : e.track.durationMs / 1000)}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="shrink-0 border-t border-border px-2 py-1 text-[11px] text-muted" data-testid="queue-summary">
        {entries.length} track{entries.length === 1 ? "" : "s"} · total {formatTime(totalSeconds)}
      </div>
    </section>
  );
}
