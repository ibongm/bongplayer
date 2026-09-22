import { useAutomixStore } from "../store/useAutomixStore";
import { loadTrackMetadata } from "./trackLoader";

/** Enqueues a track immediately, then patches in its duration once decoded (for the queue's "total time"). */
export function enqueueTrackWithDuration(filePath: string, fileName: string): void {
  useAutomixStore.getState().enqueue({ filePath, fileName });
  const newEntry = useAutomixStore.getState().queue.at(-1);
  if (newEntry === undefined) return;

  const entryId = newEntry.id;
  void loadTrackMetadata(filePath, fileName)
    .then((metadata) => useAutomixStore.getState().setEntryDuration(entryId, metadata.duration))
    .catch((error: unknown) => {
      console.error(`Failed to determine duration for "${fileName}":`, error);
    });
}
