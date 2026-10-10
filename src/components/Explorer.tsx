// Left column of the dock: Music Library, standard folders, drives (folder tree opened one
// level at a time), crates & playlists, and import buttons.

import { isTauri } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, type ReactNode } from "react";
import { startPointerDrag } from "../dnd/drag";
import { backend } from "../ipc/backend";
import type { CrateInfo, CrateKind } from "../ipc/types";
import {
  browser,
  crates,
  createCrate,
  notify,
  openSource,
  refreshCrates,
  run,
} from "../state/app";
import { explorer, expandFolder, loadRoots, toggleFolder } from "../state/explorer";
import { useStore } from "../state/store";
import { askText, confirmAction } from "./Dialog";
import { openMenu } from "./ContextMenu";

interface VisibleNode {
  path: string;
  name: string;
  depth: number;
}

function useVisibleTree(): VisibleNode[] {
  const state = useStore(explorer, (s) => s);
  return useMemo(() => {
    const out: VisibleNode[] = [];
    const walk = (path: string, name: string, depth: number): void => {
      out.push({ path, name, depth });
      const node = state.nodes[path];
      if (node?.expanded && node.children) {
        node.children.forEach((c) => {
          walk(c.path, c.name, depth + 1);
        });
      }
    };
    state.places.forEach((p) => {
      walk(p.path, p.name, 0);
    });
    state.drives.forEach((d) => {
      walk(d.path, d.label, 0);
    });
    return out;
  }, [state]);
}

function FolderTree(): ReactNode {
  const nodes = useVisibleTree();
  const tree = useStore(explorer, (s) => s.nodes);
  const source = useStore(browser, (s) => s.source);
  const current = source?.kind === "folder" ? source.path : null;

  const openFolder = (path: string): void => {
    void openSource({ kind: "folder", path });
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number): void => {
    const n = nodes[i];
    if (!n) return;
    const focus = (j: number): void => {
      const el = document.querySelector<HTMLElement>(`[data-tree-index="${j}"]`);
      el?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        focus(Math.min(nodes.length - 1, i + 1));
        break;
      case "ArrowUp":
        focus(Math.max(0, i - 1));
        break;
      case "ArrowRight":
        if (!tree[n.path]?.expanded) void toggleFolder(n.path);
        else focus(i + 1);
        break;
      case "ArrowLeft":
        if (tree[n.path]?.expanded) void toggleFolder(n.path);
        else {
          for (let j = i - 1; j >= 0; j--) {
            if ((nodes[j]?.depth ?? 0) < n.depth) {
              focus(j);
              break;
            }
          }
        }
        break;
      case "Enter":
        openFolder(n.path);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      role="tree"
      aria-label="Folders"
      data-drop="folder-tree"
      className="rounded data-[drop-active=true]:outline data-[drop-active=true]:outline-2 data-[drop-active=true]:outline-accent"
    >
      {nodes.map((n, i) => {
        const node = tree[n.path];
        return (
          <div
            key={`${n.path}-${n.depth}`}
            role="treeitem"
            aria-expanded={node?.expanded ?? false}
            aria-selected={current === n.path}
            aria-level={n.depth + 1}
            tabIndex={i === 0 ? 0 : -1}
            data-tree-index={i}
            title={`${n.path} — click to open, drag to Automix (↑/↓ move, → open folder, ← close, Enter show tracks)`}
            className={`flex cursor-default items-center rounded py-0.5 pr-1 text-[13px] outline-none hover:bg-surface-raised focus-visible:bg-surface-raised ${
              current === n.path ? "bg-accent/20" : ""
            }`}
            style={{ paddingLeft: 4 + n.depth * 14 }}
            onClick={() => {
              openFolder(n.path);
            }}
            onKeyDown={(e) => {
              onKeyDown(e, i);
            }}
            onPointerDown={(e) => {
              startPointerDrag(e, () => ({ kind: "files", paths: [n.path], label: `Folder ${n.name}` }));
            }}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label={node?.expanded ? `Close ${n.name}` : `Open ${n.name}`}
              className="mr-0.5 w-4 text-[10px] text-muted"
              onClick={(e) => {
                e.stopPropagation();
                void toggleFolder(n.path);
              }}
            >
              {node?.loading ? "…" : node?.expanded ? "▾" : "▸"}
            </button>
            <span className="truncate">{n.name}</span>
            {node?.error && (
              <span className="ml-1 text-[11px] text-danger" title={node.error}>
                (cannot open)
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CrateItem({ c, active }: { c: CrateInfo; active: boolean }): ReactNode {
  const rename = async (): Promise<void> => {
    const name = await askText(`Rename ${c.kind}`, "Name", c.name, "Rename");
    if (name === null) return;
    run(await backend().crateRename(c.id, name), "Rename");
    await refreshCrates();
    if (active) await openSource({ kind: "crate", id: c.id, name, crateKind: c.kind });
  };
  const remove = async (): Promise<void> => {
    const yes = await confirmAction(
      `Delete ${c.kind}`,
      `Delete “${c.name}”? The ${c.trackCount} track(s) in it stay in the library.`,
      "Delete",
      true,
    );
    if (!yes) return;
    run(await backend().crateDelete(c.id), "Delete");
    await refreshCrates();
    if (active) await openSource({ kind: "library" });
  };
  return (
    <button
      type="button"
      data-drop="crate"
      data-drop-value={String(c.id)}
      title={`${c.name} — ${c.trackCount} track(s). Drop tracks here to add them. Right-click: rename / delete (F2 / Del)`}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[13px] hover:bg-surface-raised data-[drop-active=true]:bg-accent/30 ${
        active ? "bg-accent/20" : ""
      }`}
      onClick={() => void openSource({ kind: "crate", id: c.id, name: c.name, crateKind: c.kind })}
      onKeyDown={(e) => {
        if (e.key === "F2") void rename();
        else if (e.key === "Delete") void remove();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [
          { id: "rename", label: `Rename ${c.kind}…`, shortcut: "F2", onSelect: () => void rename() },
          { id: "delete", label: `Delete ${c.kind}…`, shortcut: "Del", danger: true, onSelect: () => void remove() },
        ]);
      }}
    >
      <span aria-hidden="true">{c.kind === "playlist" ? "♪" : "▣"}</span>
      <span className="flex-1 truncate">{c.name}</span>
      <span className="text-[11px] text-muted">{c.trackCount}</span>
    </button>
  );
}

async function newCrate(kind: CrateKind): Promise<void> {
  const name = await askText(kind === "crate" ? "New crate" : "New playlist", "Name", "", "Create");
  if (name === null) return;
  const id = await createCrate(name, kind);
  if (id !== null) await openSource({ kind: "crate", id, name, crateKind: kind });
}

async function pick(directory: boolean, title: string, extensions?: string[]): Promise<string[]> {
  if (!isTauri()) {
    notify("error", "Choosing files needs the desktop app");
    return [];
  }
  const picked = await openFileDialog({
    multiple: !directory,
    directory,
    title,
    ...(extensions ? { filters: [{ name: title, extensions }] } : {}),
  });
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
}

async function importFiles(): Promise<void> {
  const files = await pick(false, "Import audio files", ["mp3", "flac", "wav", "m4a", "aac", "ogg"]);
  if (files.length === 0) return;
  const rows = run(await backend().importPaths(files), "Import files");
  if (rows) notify("info", `Imported ${rows.length} track(s)`);
  await openSource({ kind: "library" });
}

async function importFolder(): Promise<void> {
  const [folder] = await pick(true, "Import a folder");
  if (folder === undefined) return;
  const rows = run(await backend().importPaths([folder]), "Import folder");
  if (rows) notify("info", `Imported ${rows.length} track(s) from the folder and its subfolders`);
  await expandFolder(folder);
  await openSource({ kind: "folder", path: folder });
}

async function importM3u(): Promise<void> {
  const [file] = await pick(false, "Import playlist", ["m3u", "m3u8"]);
  if (file === undefined) return;
  const rep = run(await backend().importM3u(file), "Import M3U");
  if (!rep) return;
  await refreshCrates();
  const missing = rep.missing.length;
  notify(
    missing > 0 ? "error" : "info",
    `Playlist “${rep.name}”: ${rep.added} track(s) added${
      missing > 0 ? `, ${missing} not found: ${rep.missing.slice(0, 5).join("; ")}${missing > 5 ? "; …" : ""}` : ""
    }`,
  );
  await openSource({ kind: "crate", id: rep.crateId, name: rep.name, crateKind: "playlist" });
}

export function Explorer(): ReactNode {
  const list = useStore(crates, (c) => c);
  const source = useStore(browser, (s) => s.source);
  const rootsError = useStore(explorer, (s) => s.error);

  useEffect(() => {
    void loadRoots();
    void refreshCrates();
  }, []);

  return (
    <nav aria-label="Explorer" className="flex min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <button
        type="button"
        title="All tracks the library knows (Ctrl+L)"
        className={`rounded px-1.5 py-1 text-left text-[13px] font-semibold hover:bg-surface-raised ${
          source?.kind === "library" ? "bg-accent/20" : ""
        }`}
        onClick={() => void openSource({ kind: "library" })}
      >
        ♫ Music Library
      </button>

      <FolderTree />
      {rootsError && (
        <p role="alert" className="text-[11px] text-danger">
          {rootsError}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>Crates &amp; Playlists</span>
          <span className="flex gap-1">
            <button type="button" title="New crate (a set of tracks)" className="rounded px-1 hover:bg-surface-raised" onClick={() => void newCrate("crate")}>
              + Crate
            </button>
            <button type="button" title="New playlist (ordered)" className="rounded px-1 hover:bg-surface-raised" onClick={() => void newCrate("playlist")}>
              + List
            </button>
          </span>
        </div>
        {list.length === 0 ? (
          <p className="px-1.5 py-1 text-[12px] text-muted">No crates yet.</p>
        ) : (
          list.map((c) => (
            <CrateItem key={c.id} c={c} active={source?.kind === "crate" && source.id === c.id} />
          ))
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-1 border-t border-border pt-2">
        <button type="button" className="rounded px-2 py-1 text-[12px] hover:bg-surface-raised" title="Import audio files into the library" onClick={() => void importFiles()}>
          Import Files
        </button>
        <button type="button" className="rounded px-2 py-1 text-[12px] hover:bg-surface-raised" title="Import a folder (with subfolders) into the library" onClick={() => void importFolder()}>
          Import Folder
        </button>
        <button type="button" className="rounded px-2 py-1 text-[12px] hover:bg-surface-raised" title="Import an .m3u / .m3u8 playlist" onClick={() => void importM3u()}>
          Import M3U
        </button>
      </div>
    </nav>
  );
}
