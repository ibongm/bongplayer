import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface LibraryTrackEntry {
  readonly filePath: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** Epoch milliseconds; null when the filesystem didn't report a mtime. */
  readonly modifiedAt: number | null;
}

export type LibrarySortColumn = "fileName" | "sizeBytes" | "modifiedAt";
export type SortDirection = "asc" | "desc";

export interface LibraryState {
  readonly selectedFolderPath: string | null;
  readonly files: readonly LibraryTrackEntry[];
  readonly isScanning: boolean;
  readonly searchQuery: string;
  readonly sortColumn: LibrarySortColumn;
  readonly sortDirection: SortDirection;

  setSelectedFolder(path: string | null): void;
  setScanning(scanning: boolean): void;
  setFiles(files: readonly LibraryTrackEntry[]): void;
  setSearchQuery(query: string): void;
  setSort(column: LibrarySortColumn, direction?: SortDirection): void;
  toggleSortDirection(): void;
}

export const useLibraryStore = create<LibraryState>()(
  devtools(
    (set) => ({
      selectedFolderPath: null,
      files: [],
      isScanning: false,
      searchQuery: "",
      sortColumn: "fileName",
      sortDirection: "asc",

      setSelectedFolder(path) {
        set({ selectedFolderPath: path }, false, "setSelectedFolder");
      },

      setScanning(scanning) {
        set({ isScanning: scanning }, false, "setScanning");
      },

      setFiles(files) {
        set({ files }, false, "setFiles");
      },

      setSearchQuery(query) {
        set({ searchQuery: query }, false, "setSearchQuery");
      },

      setSort(column, direction) {
        set(
          (state) => ({
            sortColumn: column,
            sortDirection: direction ?? (state.sortColumn === column ? state.sortDirection : "asc"),
          }),
          false,
          "setSort",
        );
      },

      toggleSortDirection() {
        set(
          (state) => ({ sortDirection: state.sortDirection === "asc" ? "desc" : "asc" }),
          false,
          "toggleSortDirection",
        );
      },
    }),
    { name: "library" },
  ),
);

export interface FilterableLibraryFields {
  readonly files: readonly LibraryTrackEntry[];
  readonly searchQuery: string;
  readonly sortColumn: LibrarySortColumn;
  readonly sortDirection: SortDirection;
}

/**
 * Search-filters and sorts the library's files — reusable across any
 * component that lists them. This returns a NEW array every call, so never
 * pass it directly as a zustand selector (useLibraryStore(selectFilteredFiles))
 * — that makes every render's snapshot a new reference and triggers an
 * infinite update loop via useSyncExternalStore. Select the raw fields
 * individually and memoize a call to this with useMemo instead.
 */
export function selectFilteredFiles(state: FilterableLibraryFields): readonly LibraryTrackEntry[] {
  const query = state.searchQuery.trim().toLowerCase();
  const filtered =
    query === ""
      ? state.files
      : state.files.filter((file) => file.fileName.toLowerCase().includes(query));

  const direction = state.sortDirection === "asc" ? 1 : -1;
  const column = state.sortColumn;
  return [...filtered].sort((a, b) => {
    const left = normalizeSortValue(a[column]);
    const right = normalizeSortValue(b[column]);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return 0;
  });
}

function normalizeSortValue(value: string | number | null): string | number | null {
  return typeof value === "string" ? value.toLowerCase() : value;
}
