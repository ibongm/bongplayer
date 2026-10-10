// The track context menu: every action applies to the whole selection and says how many
// tracks it affects. "Load to deck" with several tracks selected loads the focused one, and
// says which.

import { askText, confirmAction } from "../components/Dialog";
import type { MenuItem } from "../components/ContextMenu";
import { backend } from "../ipc/backend";
import type { DeckName } from "../ipc/types";
import {
  addToCrate,
  browser,
  crates,
  createCrate,
  enqueue,
  loadToDeck,
  notify,
  refresh,
  refreshCrates,
  refreshQueue,
  run,
  type TableRow,
} from "./app";

function plural(n: number, word = "track"): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function shortTitle(row: TableRow): string {
  const t = row.track.title || row.track.path.split(/[\\/]/).pop() || "track";
  return t.length > 32 ? `${t.slice(0, 31)}…` : t;
}

export interface MenuContext {
  /** Selected rows in table order (at least one). */
  selected: TableRow[];
  /** The row that "Load to deck" uses. */
  focused: TableRow;
}

function loadItem(ctx: MenuContext, deck: DeckName): MenuItem {
  const label =
    ctx.selected.length > 1
      ? `Load “${shortTitle(ctx.focused)}” to Deck ${deck}`
      : `Load to Deck ${deck}`;
  return {
    id: `load-${deck}`,
    label,
    shortcut: deck === "A" ? "Enter" : "Shift+Enter",
    onSelect: () => void loadToDeck(deck, ctx.focused.track.id),
  };
}

async function setBpmEach(rows: TableRow[], f: (bpm: number) => number): Promise<void> {
  const withBpm = rows.filter((r) => r.track.bpm !== null);
  for (const r of withBpm) {
    if (r.track.bpm !== null) {
      run(await backend().setBpm([r.track.id], Math.round(f(r.track.bpm) * 100) / 100), "Set BPM");
    }
  }
  notify("info", `BPM changed on ${plural(withBpm.length)}`);
  await refresh();
}

export function trackMenu(ctx: MenuContext): MenuItem[] {
  const ids = ctx.selected.map((r) => r.track.id);
  const n = ids.length;
  const source = browser.get().source;
  const crateItems: MenuItem[] = crates.get().map((c) => ({
    id: `crate-${c.id}`,
    label: `${c.kind === "playlist" ? "♪" : "▣"} ${c.name}`,
    onSelect: () => void addToCrate(c.id, ids),
  }));
  const newCrate = async (kind: "crate" | "playlist"): Promise<void> => {
    const name = await askText(kind === "crate" ? "New crate" : "New playlist", "Name");
    if (name === null) return;
    const id = await createCrate(name, kind);
    if (id !== null) await addToCrate(id, ids);
  };

  const items: MenuItem[] = [
    loadItem(ctx, "A"),
    loadItem(ctx, "B"),
    {
      id: "automix",
      label: `Add ${plural(n)} to Automix`,
      shortcut: "Q",
      separator: true,
      onSelect: () => void enqueue(ids),
    },
    {
      id: "add-to-crate",
      label: `Add ${plural(n)} to crate`,
      submenu: [
        ...crateItems,
        {
          id: "new-crate",
          label: "New crate…",
          separator: crateItems.length > 0,
          onSelect: () => void newCrate("crate"),
        },
        { id: "new-playlist", label: "New playlist…", onSelect: () => void newCrate("playlist") },
      ],
    },
    {
      id: "batch",
      label: "Batch Operations",
      submenu: [
        {
          id: "analyze",
          label: `Analyze BPM & key (${plural(n)})`,
          onSelect: () =>
            void (async () => {
              notify("info", `Analyzing ${plural(n)}…`);
              const rep = run(await backend().analyzeTracks(ids), "Analyze");
              if (rep) {
                const failed = rep.failed.length > 0 ? `, ${rep.failed.length} failed` : "";
                notify(
                  rep.failed.length > 0 ? "error" : "info",
                  `Analyzed ${plural(rep.analyzed)} in ${rep.seconds.toFixed(1)} s${failed}`,
                );
              }
              await refresh();
            })(),
        },
        {
          id: "bpm-double",
          label: `Double BPM (${plural(n)})`,
          onSelect: () => void setBpmEach(ctx.selected, (b) => b * 2),
        },
        {
          id: "bpm-halve",
          label: `Halve BPM (${plural(n)})`,
          onSelect: () => void setBpmEach(ctx.selected, (b) => b / 2),
        },
        {
          id: "bpm-set",
          label: `Set BPM… (${plural(n)})`,
          onSelect: () =>
            void (async () => {
              const v = await askText("Set BPM", `BPM for ${plural(n)}`, String(ctx.focused.track.bpm ?? ""));
              if (v === null) return;
              const bpm = Number(v.replace(",", "."));
              if (!Number.isFinite(bpm)) {
                notify("error", `“${v}” is not a number`);
                return;
              }
              run(await backend().setBpm(ids, bpm), "Set BPM");
              await refresh();
            })(),
        },
        {
          id: "bpm-clear",
          label: `Use analysed BPM again (${plural(n)})`,
          onSelect: () =>
            void (async () => {
              run(await backend().setBpm(ids, null), "Clear BPM");
              await refresh();
            })(),
        },
        {
          id: "rating",
          label: `Rating (${plural(n)})`,
          separator: true,
          submenu: [0, 1, 2, 3, 4, 5].map((stars) => ({
            id: `rating-${stars}`,
            label: stars === 0 ? "No rating" : "★".repeat(stars),
            onSelect: () =>
              void (async () => {
                run(await backend().setRating(ids, stars), "Rating");
                await refresh();
              })(),
          })),
        },
      ],
    },
    {
      id: "file",
      label: "File Operations",
      submenu: [
        {
          id: "explorer",
          label: `Show “${shortTitle(ctx.focused)}” in Explorer`,
          onSelect: () => void backend().showInExplorer(ctx.focused.track.path).then((r) => run(r, "Show in Explorer")),
        },
        {
          id: "copy-paths",
          label: n === 1 ? "Copy file path" : `Copy ${plural(n, "file path")}`,
          onSelect: () =>
            void navigator.clipboard
              .writeText(ctx.selected.map((r) => r.track.path).join("\r\n"))
              .then(
                () => {
                  notify("info", `Copied ${plural(n, "path")}`);
                },
                () => {
                  notify("error", "Could not copy to the clipboard");
                },
              ),
        },
      ],
    },
    {
      id: "played",
      label: `Mark ${plural(n)} as played`,
      separator: true,
      onSelect: () =>
        void (async () => {
          run(await backend().markPlayed(ids), "Mark as played");
          await refresh();
        })(),
    },
  ];

  if (source?.kind === "crate") {
    const positions = ctx.selected.flatMap((r) => (r.position === undefined ? [] : [r.position]));
    items.push({
      id: "remove-from-crate",
      label: `Remove ${plural(n)} from “${source.name}”`,
      shortcut: "Del",
      onSelect: () =>
        void (async () => {
          run(await backend().crateRemove(source.id, positions), "Remove from crate");
          await refreshCrates();
          await refresh();
        })(),
    });
  }
  // In a folder view the files are simply what is on disk, so "remove from library" would
  // only reset their history; it is offered in the Music Library and in crates.
  if (source?.kind === "folder") return items;
  items.push({
    id: "remove",
    label: `Remove ${plural(n)} from library`,
    ...(source?.kind === "crate" ? {} : { shortcut: "Del" }),
    danger: true,
    onSelect: () =>
      void (async () => {
        const yes = await confirmAction(
          "Remove from library",
          `Remove ${plural(n)} from the library? The files stay on disk; play counts, cues and crate entries of these tracks are deleted.`,
          `Remove ${plural(n)}`,
          true,
        );
        if (!yes) return;
        const removed = run(await backend().removeTracks(ids), "Remove from library");
        if (removed !== null) notify("info", `Removed ${plural(removed)} from the library`);
        await refreshQueue();
        await refreshCrates();
        await refresh();
      })(),
  });
  return items;
}
