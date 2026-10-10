// DAY view: what staff need during the day — what is playing, what comes next, Automix on /
// off, skip, DUCK, LOCK, volume — in big, clear controls. The queue is beside it.

import type { ReactNode } from "react";
import { backend } from "../ipc/backend";
import { notify, queue, status } from "../state/app";
import { useStore } from "../state/store";
import { livePosition, mixer, setMaster } from "../state/ui";
import { AutomixPanel } from "./AutomixPanel";
import { toggleAutomix } from "./AutomixCockpit";
import { Fader } from "./controls/Fader";
import { useLive, useLiveText } from "./deck/useLiveText";
import { DuckButton, LockButton } from "./LockDuck";
import { formatTime } from "./TrackTable";

function NowPlaying(): ReactNode {
  // The deck Automix is playing, or whichever deck is playing.
  const deck = useStore(status, (s) => {
    if (!s) return 0;
    if (s.decks[1].playing && !s.decks[0].playing) return 1;
    return 0;
  });
  const title = useStore(status, (s) => s?.decks[deck].title ?? "");
  const artist = useStore(status, (s) => s?.decks[deck].artist ?? "");
  const loaded = useStore(status, (s) => s?.decks[deck].loaded ?? false);
  const timeRef = useLiveText<HTMLSpanElement>((s) => {
    const d = s?.decks[deck];
    if (!d?.loaded || d.duration === null) return "";
    const pos = livePosition(deck);
    return `${formatTime(pos)} / ${formatTime(d.duration)} · −${formatTime(d.duration - pos)}`;
  });
  const barRef = useLive<HTMLDivElement>((el, s) => {
    const d = s?.decks[deck];
    const pct = d?.duration ? (livePosition(deck) / d.duration) * 100 : 0;
    el.style.width = `${pct.toFixed(2)}%`;
  });
  return (
    <section aria-label="Now playing" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
      <span className="text-[12px] font-semibold tracking-wide text-muted">NOW PLAYING</span>
      <span className="truncate text-[30px] font-bold leading-tight" data-testid="day-title">
        {loaded ? title || "Untitled" : "Nothing is playing"}
      </span>
      <span className="truncate text-[20px] text-muted">{loaded ? artist : "Add tracks to Automix and press START"}</span>
      <div className="h-2 w-full overflow-hidden rounded bg-bg">
        <div ref={barRef} className="h-full bg-accent" style={{ width: "0%" }} />
      </div>
      <span ref={timeRef} className="text-[16px] tabular-nums text-muted" />
    </section>
  );
}

function UpNext(): ReactNode {
  const nextUid = useStore(status, (s) => s?.automix.nextUid ?? null);
  const entries = useStore(queue, (q) => q);
  const next = entries.find((e) => e.uid === nextUid);
  return (
    <section aria-label="Up next" className="rounded-lg border border-border bg-surface p-4">
      <span className="text-[12px] font-semibold tracking-wide text-muted">UP NEXT</span>
      <div className="truncate text-[18px] font-semibold">
        {next ? `${next.track.artist ? `${next.track.artist} – ` : ""}${next.track.title}` : "—"}
      </div>
    </section>
  );
}

export function DayView(): ReactNode {
  const on = useStore(status, (s) => s?.automix.on ?? false);
  const locked = useStore(status, (s) => s?.locked ?? false);
  const master = useStore(mixer, (m) => m.master);
  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <NowPlaying />
        <UpNext />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={on}
            disabled={locked}
            title={on ? "Stop Automix" : "Start Automix"}
            className={`rounded-lg px-6 py-3 text-[18px] font-bold disabled:opacity-40 ${on ? "bg-accent text-bg" : "bg-surface-raised hover:bg-accent/30"}`}
            onClick={toggleAutomix}
          >
            {on ? "■ AUTOMIX ON" : "▶ START"}
          </button>
          <button
            type="button"
            disabled={!on || locked}
            title="Next track now"
            className="rounded-lg bg-surface-raised px-6 py-3 text-[18px] font-bold hover:bg-accent/30 disabled:opacity-40"
            onClick={() =>
              void backend()
                .automixSkip()
                .then((r) => {
                  if (!r.ok) notify("error", `Skip: ${r.error}`);
                })
            }
          >
            ⏭ NEXT
          </button>
          <DuckButton big />
          <LockButton big />
          <div className="ml-auto">
            <Fader
              label="VOLUME"
              orientation="horizontal"
              length={220}
              value={master}
              min={-24}
              max={6}
              defaultValue={0}
              steps={60}
              format={(v) => `${v.toFixed(1)} dB`}
              onChange={(v) => {
                setMaster(v <= -24 ? -120 : v);
              }}
            />
          </div>
        </div>
      </div>
      <div className="flex w-[380px] min-w-0 flex-col rounded-lg border border-border bg-surface/60">
        <AutomixPanel />
      </div>
    </div>
  );
}
