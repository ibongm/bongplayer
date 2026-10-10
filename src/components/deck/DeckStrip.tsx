// Compact deck: what is loaded, time, play/pause. Drop target for tracks and files.

import type { ReactNode } from "react";
import { backend } from "../../ipc/backend";
import type { DeckName } from "../../ipc/types";
import { run, status } from "../../state/app";
import { useStore } from "../../state/store";
import { formatTime } from "../TrackTable";
import { useLiveText } from "./useLiveText";

export function DeckStrip({ deck }: { deck: DeckName }): ReactNode {
  const i = deck === "A" ? 0 : 1;
  const title = useStore(status, (s) => s?.decks[i].title ?? "");
  const artist = useStore(status, (s) => s?.decks[i].artist ?? "");
  const loaded = useStore(status, (s) => s?.decks[i].loaded ?? false);
  const playing = useStore(status, (s) => s?.decks[i].playing ?? false);
  const error = useStore(status, (s) => s?.decks[i].decodeError ?? null);
  const timeRef = useLiveText<HTMLSpanElement>((s) => {
    const d = s?.decks[i];
    if (!d?.loaded) return "";
    const remain = d.duration === null ? null : d.duration - d.position;
    return `${formatTime(d.position)}  −${formatTime(remain)}`;
  });

  return (
    <div
      data-drop="deck"
      data-drop-value={deck}
      aria-label={`Deck ${deck}`}
      className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 data-[drop-active=true]:border-accent data-[drop-active=true]:bg-accent/15"
    >
      <span className="text-[22px] font-black text-accent">{deck}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold" data-testid={`deck-${deck}-title`}>
          {loaded ? title || "Untitled" : "Drop a track here"}
        </div>
        <div className="truncate text-[12px] text-muted">{loaded ? artist : `Deck ${deck} is empty`}</div>
        {error && (
          <div role="alert" className="truncate text-[11px] text-danger">
            {error}
          </div>
        )}
      </div>
      <span ref={timeRef} className="text-[13px] tabular-nums text-muted" />
      <button
        type="button"
        disabled={!loaded}
        title={`${playing ? "Pause" : "Play"} deck ${deck} (${deck === "A" ? "F1" : "F5"})`}
        aria-label={`${playing ? "Pause" : "Play"} deck ${deck}`}
        className="h-9 w-12 rounded bg-surface-raised text-[16px] hover:bg-accent hover:text-bg disabled:opacity-40"
        onClick={() =>
          void backend()
            .engineCommand({ type: "togglePlay", deck })
            .then((r) => run(r, `Deck ${deck}`))
        }
      >
        {playing ? "❚❚" : "▶"}
      </button>
    </div>
  );
}
