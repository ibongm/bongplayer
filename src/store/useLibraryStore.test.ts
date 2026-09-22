import { beforeEach, describe, expect, it } from "vitest";
import { selectFilteredFiles, useLibraryStore, type LibraryTrackEntry } from "./useLibraryStore";

const FILES: LibraryTrackEntry[] = [
  { filePath: "/a.mp3", fileName: "Banana.mp3", sizeBytes: 300, modifiedAt: 2 },
  { filePath: "/b.mp3", fileName: "apple.mp3", sizeBytes: 100, modifiedAt: null },
  { filePath: "/c.mp3", fileName: "Cherry.mp3", sizeBytes: 200, modifiedAt: 1 },
];

beforeEach(() => {
  useLibraryStore.setState(useLibraryStore.getInitialState(), true);
});

describe("useLibraryStore", () => {
  it("stores the selected folder and scanned files", () => {
    useLibraryStore.getState().setSelectedFolder("C:/Music");
    useLibraryStore.getState().setFiles(FILES);

    expect(useLibraryStore.getState().selectedFolderPath).toBe("C:/Music");
    expect(useLibraryStore.getState().files).toHaveLength(3);
  });

  it("setSort switching columns defaults to ascending; re-clicking the same column keeps direction unless given one", () => {
    const store = useLibraryStore.getState();
    store.setSort("sizeBytes");
    expect(useLibraryStore.getState().sortColumn).toBe("sizeBytes");
    expect(useLibraryStore.getState().sortDirection).toBe("asc");

    useLibraryStore.getState().toggleSortDirection();
    expect(useLibraryStore.getState().sortDirection).toBe("desc");

    useLibraryStore.getState().setSort("fileName");
    expect(useLibraryStore.getState().sortDirection).toBe("asc");
  });
});

describe("selectFilteredFiles", () => {
  it("sorts case-insensitively by the active column and direction", () => {
    const state = {
      ...useLibraryStore.getInitialState(),
      files: FILES,
      sortColumn: "fileName" as const,
    };
    const sorted = selectFilteredFiles(state).map((file) => file.fileName);
    expect(sorted).toEqual(["apple.mp3", "Banana.mp3", "Cherry.mp3"]);
  });

  it("filters by search query, case-insensitively, before sorting", () => {
    const state = { ...useLibraryStore.getInitialState(), files: FILES, searchQuery: "an" };
    const filtered = selectFilteredFiles(state).map((file) => file.fileName);
    expect(filtered).toEqual(["Banana.mp3"]);
  });

  it("sorts nulls last regardless of direction", () => {
    const ascending = {
      ...useLibraryStore.getInitialState(),
      files: FILES,
      sortColumn: "modifiedAt" as const,
      sortDirection: "asc" as const,
    };
    expect(selectFilteredFiles(ascending).map((file) => file.fileName)).toEqual([
      "Cherry.mp3",
      "Banana.mp3",
      "apple.mp3",
    ]);

    const descending = { ...ascending, sortDirection: "desc" as const };
    expect(selectFilteredFiles(descending).map((file) => file.fileName)).toEqual([
      "Banana.mp3",
      "Cherry.mp3",
      "apple.mp3",
    ]);
  });
});
