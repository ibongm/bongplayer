import { useEffect, useMemo, useRef, useState } from "react";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useDeckController } from "../../hooks/useDeckController";
import { resolveLyrics, type ResolvedLyrics } from "../../services/lyrics";
import { activeLyricLineIndex, pickKaraokeDeck } from "./karaokeLogic";

export interface KaraokeStageProps {
  readonly onClose: () => void;
}

/**
 * Full-bleed synced lyrics stage (Phase 8): follows whichever deck is
 * playing, highlighting the current line and letting the click take you
 * there (only when the resolved lyrics are actually synced — plain text has
 * no meaningful timestamp to seek to). Rendered as a fixed overlay from
 * App.tsx, toggled by a header button, rather than living in the resizable
 * lower-bay dock — "full-bleed" reads as its own mode, not a ~25%-width
 * column.
 */
export function KaraokeStage({ onClose }: KaraokeStageProps) {
  const trackA = useDeckAStore((state) => state.track);
  const playbackA = useDeckAStore((state) => state.playbackState);
  const currentTimeA = useDeckAStore((state) => state.currentTimeSeconds);
  const trackB = useDeckBStore((state) => state.track);
  const playbackB = useDeckBStore((state) => state.playbackState);
  const currentTimeB = useDeckBStore((state) => state.currentTimeSeconds);

  const activeDeck = pickKaraokeDeck(
    { track: trackA, playbackState: playbackA },
    { track: trackB, playbackState: playbackB },
  );
  const track = activeDeck === "a" ? trackA : activeDeck === "b" ? trackB : null;
  const currentTimeSeconds =
    activeDeck === "a" ? currentTimeA : activeDeck === "b" ? currentTimeB : 0;
  // Always called (rules of hooks) — "a" is an inert fallback when no deck
  // is active; handleLineClick below never invokes it in that state.
  const controller = useDeckController(activeDeck ?? "a");

  // The last *completed* lookup, keyed by which track it was for — read
  // only inside the async callback below, never synchronously in the effect
  // body (react-hooks/set-state-in-effect forbids that; see AGENTS §4's
  // React 19 conventions). "loading"/"idle"/"notFound" are then derived from
  // comparing this against the current track, rather than tracked as their
  // own separate state.
  const [fetchResult, setFetchResult] = useState<{
    readonly filePath: string;
    readonly result: ResolvedLyrics | null;
  } | null>(null);

  useEffect(() => {
    if (track === null) return;
    let cancelled = false;
    void resolveLyrics(track.filePath, track.artist, track.title, track.duration).then((result) => {
      if (cancelled) return;
      setFetchResult({ filePath: track.filePath, result });
    });
    return () => {
      cancelled = true;
    };
  }, [track]);

  const currentFetch =
    track !== null && fetchResult !== null && fetchResult.filePath === track.filePath
      ? fetchResult
      : null;
  const displayedLyrics = currentFetch?.result ?? null;
  const displayedStatus: "idle" | "loading" | "notFound" = (() => {
    if (track === null) return "idle";
    if (currentFetch === null) return "loading";
    return currentFetch.result === null ? "notFound" : "idle";
  })();

  const activeIndex = useMemo(
    () => activeLyricLineIndex(displayedLyrics, currentTimeSeconds),
    [displayedLyrics, currentTimeSeconds],
  );

  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  function handleLineClick(timeSeconds: number): void {
    if (activeDeck === null) return;
    controller.seek(timeSeconds);
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface/98 backdrop-blur">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
        <div>
          <h2 className="text-lg font-semibold text-accent">Karaoke</h2>
          {track !== null && (
            <p className="text-sm text-textMuted">
              {track.title}
              {track.artist !== null ? ` — ${track.artist}` : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-surfaceRaised px-3 py-1.5 text-sm text-textPrimary hover:bg-accent/20"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-10">
        {track === null && (
          <p className="text-center text-textMuted">
            Load a track on Deck A or Deck B to see lyrics.
          </p>
        )}
        {track !== null && displayedStatus === "loading" && (
          <p className="text-center text-textMuted">Looking up lyrics…</p>
        )}
        {track !== null && displayedStatus === "notFound" && (
          <p className="text-center text-textMuted">No lyrics found for this track.</p>
        )}
        {displayedLyrics !== null && (
          <div className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            {displayedLyrics.lines.map((line, index) => (
              <p
                key={index}
                ref={index === activeIndex ? activeLineRef : undefined}
                onClick={
                  displayedLyrics.synced ? () => handleLineClick(line.timeSeconds) : undefined
                }
                className={
                  index === activeIndex
                    ? "text-3xl font-semibold text-accent transition-colors"
                    : `text-xl text-textMuted transition-colors ${displayedLyrics.synced ? "cursor-pointer hover:text-textPrimary" : ""}`
                }
              >
                {line.text}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
