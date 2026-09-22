import { useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { setDropZoneHandler } from "../../services/dragAndDrop";
import { DRIVE_ROOTS, listSubfolders, selectLibraryFolder, type FolderNode } from "./folderScanner";

interface FolderTreeItemProps {
  readonly node: FolderNode;
  readonly depth: number;
}

function FolderTreeItem({ node, depth }: FolderTreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FolderNode[] | null>(null);
  const isSelected = useLibraryStore((state) => state.selectedFolderPath === node.path);

  useEffect(() => {
    if (!expanded || children !== null) return;
    let cancelled = false;
    void listSubfolders(node.path).then((folders) => {
      if (!cancelled) setChildren(folders);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, node.path, children]);

  function handleSelect(): void {
    setExpanded(true);
    void selectLibraryFolder(node.path);
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleSelect}
        onDoubleClick={() => setExpanded((prev) => !prev)}
        style={{ paddingLeft: depth * 16 }}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${
          isSelected ? "bg-accent/20 text-accent" : "text-textPrimary"
        }`}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-textMuted transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && children !== null && (
        <div>
          {children.map((child) => (
            <FolderTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Direct OS folder tree: Windows drive letters down to music folders (AGENTS §3, library/FolderTree.tsx). */
export function FolderTree() {
  useEffect(() => {
    // "Folder Tree: Auto-expand and navigate directly to dropped folder" (AGENTS §2.3).
    return setDropZoneHandler("folder-tree", (paths) => {
      const first = paths[0];
      if (first !== undefined) void selectLibraryFolder(first);
    });
  }, []);

  return (
    <div data-drop-zone="folder-tree" className="h-full overflow-y-auto p-1">
      {DRIVE_ROOTS.map((root) => (
        <FolderTreeItem key={root.path} node={root} depth={0} />
      ))}
    </div>
  );
}
