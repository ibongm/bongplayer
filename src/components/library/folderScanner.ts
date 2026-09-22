import { readDir, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { useLibraryStore, type LibraryTrackEntry } from "../../store/useLibraryStore";

export interface FolderNode {
  readonly path: string;
  readonly name: string;
}

// Matches src-tauri/capabilities/default.json's fs:scope — browsing outside
// these roots would fail with a permission error anyway.
export const DRIVE_ROOTS: readonly FolderNode[] = [
  { path: "C:\\", name: "C:" },
  { path: "D:\\", name: "D:" },
  { path: "E:\\", name: "E:" },
];

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]);

function isAudioFile(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return AUDIO_EXTENSIONS.has(fileName.slice(dotIndex + 1).toLowerCase());
}

/** Lists the immediate subfolders of `path`, alphabetically. Never throws — an unreadable folder just returns empty. */
export async function listSubfolders(path: string): Promise<FolderNode[]> {
  try {
    const entries = await readDir(path);
    const folders = entries.filter((entry) => entry.isDirectory);
    const withPaths = await Promise.all(
      folders.map(async (entry) => ({ path: await join(path, entry.name), name: entry.name })),
    );
    return withPaths.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error(`Failed to list subfolders of "${path}":`, error);
    return [];
  }
}

async function scanAudioFiles(path: string): Promise<LibraryTrackEntry[]> {
  const entries = await readDir(path);
  const audioEntries = entries.filter((entry) => entry.isFile && isAudioFile(entry.name));

  return Promise.all(
    audioEntries.map(async (entry): Promise<LibraryTrackEntry> => {
      const filePath = await join(path, entry.name);
      const info = await stat(filePath).catch(() => null);
      return {
        filePath,
        fileName: entry.name,
        sizeBytes: info?.size ?? 0,
        modifiedAt: info?.mtime !== null && info?.mtime !== undefined ? info.mtime.getTime() : null,
      };
    }),
  );
}

/** Selects a folder in the library store and scans it for audio files. */
export async function selectLibraryFolder(path: string): Promise<void> {
  const library = useLibraryStore.getState();
  library.setSelectedFolder(path);
  library.setScanning(true);
  try {
    library.setFiles(await scanAudioFiles(path));
  } catch (error) {
    console.error(`Failed to scan folder "${path}":`, error);
    library.setFiles([]);
  } finally {
    library.setScanning(false);
  }
}
