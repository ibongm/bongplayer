// Karaoke: the lyrics of the deck the audience hears, the current line highlighted as the
// track plays, click a line to jump there. Used in the mixer's KARAOKE tab and in the big
// LRC drawer.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Lyrics } from "../ipc/types";
import { status } from "../state/app";
import { activeDeck, currentLine, lyricsDrawer, lyricsFor } from "../state/lyrics";
import { useStore } from "../state/store";
import { livePosition, send } from "../state/ui";
import { useLive } from "./deck/useLiveText";

type Loaded = { trackId: number; lyrics: Lyrics | null; error: string | null };

const SOURCE: Record<Lyrics["source"], string> = {
  file: ".lrc file",
  embedded: "file tags",
  lrclib: "LRCLIB",
};

export function LyricsView({ big = false }: { big?: boolean }): ReactNode {
  const index = useStore(status, activeDeck);
  const trackId = useStore(status, (s) => (index === null ? null : (s?.decks[index].trackId ?? null)));
  const live = useStore(status, (s) => (index === null ? false : (s?.decks[index].live ?? false)));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = useRef(-2);

  useEffect(() => {
    if (trackId === null || trackId < 0) return;
    let alive = true;
    void lyricsFor(trackId).then((r) => {
      if (!alive) return;
      setLoaded(r.ok ? { trackId, lyrics: r.value, error: null } : { trackId, lyrics: null, error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [trackId]);

  const lyrics = loaded?.trackId === trackId ? loaded.lyrics : null;
  const synced = lyrics?.synced ?? false;

  // Highlight the current line every frame without re-rendering React.
  const listRef = useLive<HTMLOListElement>((el) => {
    if (!lyrics || !synced || index === null) return;
    const i = currentLine(lyrics.lines, livePosition(index));
    if (i === current.current) return;
    current.current = i;
    const items = el.children;
    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      if (!(item instanceof HTMLElement)) continue;
      if (k === i) {
        item.setAttribute("aria-current", "true");
        if (typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "center", behavior: "smooth" });
      } else item.removeAttribute("aria-current");
    }
  });

  // A new set of lines: recompute the highlight on the next frame.
  useEffect(() => {
    current.current = -2;
  }, [lyrics]);

  const deckName = index === 1 ? "B" : "A";
  let message: string | null = null;
  if (index === null) message = "Load a track to see its lyrics.";
  else if (live) message = "A radio station is playing: no lyrics.";
  else if (loaded === null || loaded.trackId !== trackId) message = "Looking for lyrics…";
  else if (loaded.error) message = `Lyrics: ${loaded.error}`;
  else if (!lyrics) message = "No lyrics found (no .lrc file, none in the file's tags, nothing online).";
  else if (lyrics.instrumental) message = "Instrumental — no lyrics.";

  const text = big ? "text-[28px] leading-snug" : "text-[13px]";
  return (
    <section aria-label={big ? "Lyrics drawer" : "Karaoke lyrics"} className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 truncate px-1 pb-1 text-[11px] text-muted">
        {index === null ? "Lyrics" : `Deck ${deckName}`}
        {lyrics && !lyrics.instrumental && ` · from ${SOURCE[lyrics.source]}${synced ? "" : " · not synced (no highlight)"}`}
      </p>
      {message !== null ? (
        <p role={loaded?.error ? "alert" : "status"} className={`p-2 text-muted ${big ? "text-[18px]" : "text-[12px]"}`}>
          {message}
        </p>
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1" aria-label="Lyrics lines">
          {lyrics?.lines.map((l, i) => (
            <li key={`${i}-${l.ms}`} className={`${text} rounded text-muted aria-[current=true]:bg-accent/20 aria-[current=true]:font-semibold aria-[current=true]:text-text`}>
              {synced ? (
                <button
                  type="button"
                  className="w-full px-1 py-0.5 text-left hover:text-text"
                  title={`Jump deck ${deckName} to ${Math.floor(l.ms / 60000)}:${String(Math.floor(l.ms / 1000) % 60).padStart(2, "0")}`}
                  onClick={() => {
                    void send({ type: "seek", deck: deckName, seconds: l.ms / 1000 }, "Seek");
                  }}
                >
                  {l.text || "♪"}
                </button>
              ) : (
                <span className="block px-1 py-0.5">{l.text || " "}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The big lyrics drawer over the lower part of the window (LRC button, Ctrl+Y). */
export function LyricsDrawer(): ReactNode {
  const open = useStore(lyricsDrawer, (o) => o);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Lyrics"
      className="fixed right-0 bottom-0 left-0 z-40 flex h-[45vh] flex-col border-t-2 border-accent bg-surface/95 p-3 shadow-2xl"
    >
      <div className="flex shrink-0 justify-end">
        <button
          type="button"
          aria-label="Close lyrics"
          title="Close the lyrics drawer (LRC button or Ctrl+Y)"
          className="rounded px-2 text-muted hover:text-text"
          onClick={() => {
            lyricsDrawer.set(false);
          }}
        >
          ✕
        </button>
      </div>
      <LyricsView big />
    </div>
  );
}
