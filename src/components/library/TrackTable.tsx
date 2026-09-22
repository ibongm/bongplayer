import { useEffect, useMemo, useRef, useState } from "react";
import {
  selectFilteredFiles,
  useLibraryStore,
  type LibrarySortColumn,
  type LibraryTrackEntry,
} from "../../store/useLibraryStore";
import { useUIStore } from "../../store/useUIStore";
import { beginTrackDrag } from "../../services/dragAndDrop";

const ROW_HEIGHT_PX = 28;
const OVERSCAN_ROWS = 6;

function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatModified(epochMs: number | null): string {
  if (epochMs === null) return "—";
  return new Date(epochMs).toLocaleDateString();
}

function sortIndicator(active: boolean, direction: "asc" | "desc"): string {
  if (!active) return "";
  return direction === "asc" ? " ▲" : " ▼";
}

interface TrackRowProps {
  readonly file: LibraryTrackEntry;
}

function TrackRow({ file }: TrackRowProps) {
  return (
    <div
      draggable
      onDragStart={(event) =>
        beginTrackDrag(event.nativeEvent, { filePath: file.filePath, fileName: file.fileName })
      }
      onContextMenu={(event) => {
        useUIStore.getState().openContextMenu({
          x: event.clientX,
          y: event.clientY,
          target: { kind: "trackRow", filePath: file.filePath, fileName: file.fileName },
        });
      }}
      style={{ height: ROW_HEIGHT_PX }}
      className="grid grid-cols-[1fr_100px_140px] items-center gap-2 px-2 text-sm text-textPrimary hover:bg-white/5"
    >
      <span className="truncate">{file.fileName}</span>
      <span className="truncate text-textMuted">{formatSize(file.sizeBytes)}</span>
      <span className="truncate text-textMuted">{formatModified(file.modifiedAt)}</span>
    </div>
  );
}

/**
 * Virtualized library track table (AGENTS §3, library/TrackTable.tsx). Hand-rolled
 * windowing rather than a new dependency — only the rows within the scrolled
 * viewport (plus overscan) are ever mounted.
 *
 * Note: columns show fileName/size/modified — the fileName-based "title"
 * shown here isn't tag-read metadata (no ID3/Vorbis-comment reading exists
 * yet); real title/artist/BPM only populate once a track is actually loaded
 * into a deck (see src/services/trackLoader.ts) or analyzed (Phase 7).
 */
export function TrackTable() {
  const rawFiles = useLibraryStore((state) => state.files);
  const searchQuery = useLibraryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const sortColumn = useLibraryStore((state) => state.sortColumn);
  const sortDirection = useLibraryStore((state) => state.sortDirection);
  const setSort = useLibraryStore((state) => state.setSort);
  const toggleSortDirection = useLibraryStore((state) => state.toggleSortDirection);
  const isScanning = useLibraryStore((state) => state.isScanning);

  const files = useMemo(
    () => selectFilteredFiles({ files: rawFiles, searchQuery, sortColumn, sortDirection }),
    [rawFiles, searchQuery, sortColumn, sortDirection],
  );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  function handleHeaderClick(column: LibrarySortColumn): void {
    if (sortColumn === column) {
      toggleSortDirection();
    } else {
      setSort(column);
    }
  }

  const total = files.length;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(viewportHeight / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
  const lastVisible = Math.min(total, firstVisible + visibleRowCount);
  const topSpacerPx = firstVisible * ROW_HEIGHT_PX;
  const bottomSpacerPx = (total - lastVisible) * ROW_HEIGHT_PX;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 p-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search tracks..."
          className="w-full rounded bg-surface px-2 py-1 text-sm text-textPrimary placeholder:text-textMuted"
        />
      </div>
      <div className="grid grid-cols-[1fr_100px_140px] gap-2 border-b border-white/10 px-2 py-1 text-xs font-medium text-textMuted">
        <button type="button" onClick={() => handleHeaderClick("fileName")} className="text-left">
          Title{sortIndicator(sortColumn === "fileName", sortDirection)}
        </button>
        <button type="button" onClick={() => handleHeaderClick("sizeBytes")} className="text-left">
          Size{sortIndicator(sortColumn === "sizeBytes", sortDirection)}
        </button>
        <button type="button" onClick={() => handleHeaderClick("modifiedAt")} className="text-left">
          Modified{sortIndicator(sortColumn === "modifiedAt", sortDirection)}
        </button>
      </div>
      <div
        ref={viewportRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto"
      >
        {isScanning && <p className="p-2 text-sm text-textMuted">Scanning…</p>}
        {!isScanning && total === 0 && (
          <p className="p-2 text-sm text-textMuted">No tracks found.</p>
        )}
        <div style={{ height: topSpacerPx }} />
        {files.slice(firstVisible, lastVisible).map((file) => (
          <TrackRow key={file.filePath} file={file} />
        ))}
        <div style={{ height: bottomSpacerPx }} />
      </div>
    </div>
  );
}
