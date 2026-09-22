import { useEffect } from "react";
import {
  useAutomixStore,
  type AutomixQueueEntry,
  type TransitionStyle,
} from "../../store/useAutomixStore";
import { useUIStore } from "../../store/useUIStore";
import { allowTrackDrop, readTrackDrop, setDropZoneHandler } from "../../services/dragAndDrop";
import { enqueueTrackWithDuration } from "../../services/automixEnqueue";

const TRANSITION_LABELS: Readonly<Record<TransitionStyle, string>> = {
  smooth: "Smooth",
  bassSwap: "Bass Swap",
  cut: "Cut",
  echoOut: "Echo Out",
};

const TRANSITION_STYLES: readonly TransitionStyle[] = ["smooth", "bassSwap", "cut", "echoOut"];

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface QueueRowProps {
  readonly entry: AutomixQueueEntry;
}

function QueueRow({ entry }: QueueRowProps) {
  return (
    <div
      onContextMenu={(event) => {
        useUIStore.getState().openContextMenu({
          x: event.clientX,
          y: event.clientY,
          target: { kind: "automixRow", queueId: entry.id },
        });
      }}
      className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-textPrimary hover:bg-white/5"
    >
      <span className="truncate">{entry.fileName}</span>
      <span className="shrink-0 text-textMuted">
        {entry.durationSeconds !== null ? formatDuration(entry.durationSeconds) : "—:—"}
      </span>
    </div>
  );
}

/** Staged automix queue, transport, and transition controls (AGENTS §3, library/AutomixPanel.tsx). */
export function AutomixPanel() {
  const queue = useAutomixStore((state) => state.queue);
  const status = useAutomixStore((state) => state.status);
  const transitionStyle = useAutomixStore((state) => state.transitionStyle);
  const setTransitionStyle = useAutomixStore((state) => state.setTransitionStyle);
  const start = useAutomixStore((state) => state.start);
  const pause = useAutomixStore((state) => state.pause);
  const stop = useAutomixStore((state) => state.stop);
  const clearQueue = useAutomixStore((state) => state.clearQueue);

  useEffect(() => {
    return setDropZoneHandler("automix", (paths) => {
      for (const path of paths) {
        const fileName = path.split(/[\\/]/).pop() ?? path;
        enqueueTrackWithDuration(path, fileName);
      }
    });
  }, []);

  const totalSeconds = queue.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const isRunning = status === "running";

  return (
    <div
      data-drop-zone="automix"
      className="flex h-full flex-col"
      onDragOver={(event) => allowTrackDrop(event.nativeEvent)}
      onDrop={(event) => {
        const dropped = readTrackDrop(event.nativeEvent);
        if (dropped !== null) enqueueTrackWithDuration(dropped.filePath, dropped.fileName);
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 p-2">
        <span className="text-sm font-medium text-textPrimary">Automix</span>
        <span className="text-xs text-textMuted">
          {queue.length} track{queue.length === 1 ? "" : "s"} · {formatDuration(totalSeconds)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {queue.length === 0 && <p className="p-2 text-sm text-textMuted">Queue is empty.</p>}
        {queue.map((entry) => (
          <QueueRow key={entry.id} entry={entry} />
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 p-2">
        <select
          value={transitionStyle}
          onChange={(event) => setTransitionStyle(event.target.value as TransitionStyle)}
          className="rounded bg-surface px-2 py-1 text-sm text-textPrimary"
        >
          {TRANSITION_STYLES.map((style) => (
            <option key={style} value={style}>
              {TRANSITION_LABELS[style]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={isRunning ? pause : start}
          disabled={queue.length === 0}
          className="rounded bg-accent/20 px-3 py-1 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? "Pause" : "Start"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={status === "idle"}
          className="rounded bg-surfaceRaised px-3 py-1 text-sm text-textPrimary hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={clearQueue}
          disabled={queue.length === 0}
          className="ml-auto rounded px-3 py-1 text-sm text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
