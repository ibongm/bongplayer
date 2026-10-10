// Info tab of the dock: cover and details of the focused track in the table, its rating,
// and (only when switched on in Settings → Internet) a button to look it up online.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { backend } from "../ipc/backend";
import type { TrackRow } from "../ipc/types";
import { browser, notify, refresh, run, visibleRows } from "../state/app";
import { useStore } from "../state/store";
import { internetLookup, loadInternetLookup, settingsOpen } from "../state/ui";
import { Cover, forgetCover } from "./Cover";
import { formatTime } from "./TrackTable";

function date(unix: number | null): string {
  return unix === null ? "never" : new Date(unix * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Rating({ track }: { track: TrackRow }): ReactNode {
  const set = async (n: number): Promise<void> => {
    const next = n === track.rating ? 0 : n;
    if (run(await backend().setRating([track.id], next), "Rating") !== null) await refresh();
  };
  return (
    <div role="radiogroup" aria-label="Rating" className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={track.rating === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          title={n === track.rating ? "Click again to clear the rating" : `Rate ${n} of 5`}
          className={`text-[18px] leading-none ${n <= track.rating ? "text-accent" : "text-muted hover:text-text"}`}
          onClick={() => void set(n)}
        >
          {n <= track.rating ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-[13px]" data-testid={`info-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value === "" || value === null ? <span className="text-muted">—</span> : value}
      </dd>
    </>
  );
}

function Lookup({ track, onCover }: { track: TrackRow; onCover: () => void }): ReactNode {
  const on = useStore(internetLookup, (v) => v);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadInternetLookup();
  }, []);

  if (on !== true) {
    return (
      <p className="text-[12px] text-muted">
        Internet lookup is off.{" "}
        <button
          type="button"
          className="underline hover:text-text"
          title="Open Settings → Internet (Ctrl+,)"
          onClick={() => {
            settingsOpen.set(true);
          }}
        >
          Settings → Internet
        </button>
      </p>
    );
  }

  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await backend().lookupTrack(track.id);
      if (!r.ok) {
        notify("error", `Look up: ${r.error}`);
        return;
      }
      const o = r.value;
      if (!o.fetched) notify("info", "This track was already looked up");
      else if (o.filled.length === 0 && !o.cover) notify("info", "Nothing new found online");
      else {
        const what = [...o.filled, ...(o.cover ? ["cover"] : [])].join(", ");
        notify("info", `Found ${what}${o.source ? ` (${o.source})` : ""}`);
      }
      if (o.cover) {
        forgetCover(track.id);
        onCover();
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy || track.missing}
      title="Fill empty album / year / genre and a missing cover from MusicBrainz, iTunes or Deezer (artist and title are sent)"
      className="self-start rounded bg-surface-raised px-2 py-1 text-[12px] hover:bg-accent hover:text-bg disabled:opacity-50"
      onClick={() => void go()}
    >
      {busy ? "Looking up…" : "Look up online"}
    </button>
  );
}

export function InfoPanel(): ReactNode {
  const state = useStore(browser, (s) => s);
  const rows = useMemo(() => visibleRows(state), [state]);
  const focus = state.selection.focus;
  const track = focus === null ? undefined : rows[focus]?.track;
  const [coverVersion, setCoverVersion] = useState(0);

  if (!track) {
    return (
      <section aria-label="Track info" className="p-3 text-[13px] text-muted">
        Select a track in the list to see its details.
      </section>
    );
  }

  return (
    <section aria-label="Track info" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex justify-center">
        <Cover trackId={track.id} size={200} large version={coverVersion} />
      </div>
      <div>
        <h3 className="truncate text-[15px] font-semibold" title={track.title}>
          {track.title || "Untitled"}
        </h3>
        <p className="truncate text-[13px] text-muted" title={track.artist}>
          {track.artist}
          {track.remix ? ` · ${track.remix}` : ""}
        </p>
      </div>
      <Rating track={track} />
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
        <Field label="Album" value={track.album} />
        <Field label="Year" value={track.year === null ? "" : String(track.year)} />
        <Field label="Genre" value={track.genre} />
        <Field label="Length" value={formatTime(track.durationMs === null ? null : track.durationMs / 1000)} />
        <Field label="BPM" value={track.bpm === null ? "" : `${track.bpm.toFixed(1)}${track.bpmIsManual ? " (set by hand)" : ""}`} />
        <Field label="Key" value={track.key ?? ""} />
        <Field label="Play count" value={String(track.playCount)} />
        <Field label="Last played" value={date(track.lastPlayed)} />
        <Field label="First seen" value={date(track.firstSeen)} />
        <Field label="File" value={<span title={track.path}>{track.path}</span>} />
      </dl>
      {track.missing && <p className="text-[12px] text-danger">The file is missing.</p>}
      <Lookup
        track={track}
        onCover={() => {
          setCoverVersion((v) => v + 1);
        }}
      />
    </section>
  );
}
