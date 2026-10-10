// The folder tree in the explorer column. Folders are listed one level at a time, only when
// opened (never a whole-disk scan).

import { backend } from "../ipc/backend";
import type { Drive, FolderEntry } from "../ipc/types";
import { createStore } from "./store";

export interface FolderNode {
  expanded: boolean;
  loading: boolean;
  error: string | null;
  children: FolderEntry[] | null;
  playlists: string[];
}

export interface ExplorerState {
  drives: Drive[];
  places: FolderEntry[];
  nodes: Record<string, FolderNode>;
  error: string | null;
}

export const explorer = createStore<ExplorerState>({
  drives: [],
  places: [],
  nodes: {},
  error: null,
});

const emptyNode: FolderNode = {
  expanded: false,
  loading: false,
  error: null,
  children: null,
  playlists: [],
};

function patch(path: string, change: Partial<FolderNode>): void {
  explorer.set((s) => ({
    ...s,
    nodes: { ...s.nodes, [path]: { ...(s.nodes[path] ?? emptyNode), ...change } },
  }));
}

export async function loadRoots(): Promise<void> {
  const [drives, places] = await Promise.all([backend().listDrives(), backend().specialFolders()]);
  explorer.set((s) => ({
    ...s,
    drives: drives.ok ? drives.value : s.drives,
    places: places.ok ? places.value : s.places,
    error: !drives.ok ? drives.error : !places.ok ? places.error : null,
  }));
}

async function loadChildren(path: string): Promise<boolean> {
  patch(path, { loading: true, error: null });
  const r = await backend().listDir(path);
  if (r.ok) {
    patch(path, { loading: false, children: r.value.folders, playlists: r.value.playlists });
    return true;
  }
  patch(path, { loading: false, error: r.error });
  return false;
}

export async function toggleFolder(path: string): Promise<void> {
  const node = explorer.get().nodes[path];
  if (node?.expanded) {
    patch(path, { expanded: false });
    return;
  }
  patch(path, { expanded: true });
  if (!node?.children) await loadChildren(path);
}

/** Splits a Windows path into its ancestors: "C:\a\b" → ["C:\", "C:\a", "C:\a\b"]. */
export function ancestors(path: string): string[] {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  const out: string[] = [];
  let cur = "";
  parts.forEach((p, i) => {
    cur = i === 0 ? `${p}\\` : cur.endsWith("\\") ? `${cur}${p}` : `${cur}\\${p}`;
    out.push(cur);
  });
  return out;
}

/** Opens every folder on the way to `path` so it becomes visible in the tree. */
export async function expandFolder(path: string): Promise<void> {
  for (const p of ancestors(path)) {
    const node = explorer.get().nodes[p];
    patch(p, { expanded: true });
    if (!node?.children) {
      const ok = await loadChildren(p);
      if (!ok) return;
    }
  }
}
