// Scrolling waveforms of both decks across the top, playhead in the centre, colours by
// frequency (bass / mids / treble), cue flags and loop region. Drawn at 60 fps on canvas.

import { useEffect, useRef, type ReactNode } from "react";
import { status } from "../state/app";
import { useStore } from "../state/store";
import { context2d, cssColor, ensureWaveform, livePosition, onFrame, waveforms } from "../state/ui";

/** Seconds of audio shown on each side of the playhead. */
const HALF_WINDOW = 4;

function Lane({ index }: { index: 0 | 1 }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const deck = index === 0 ? "A" : "B";
  const trackId = useStore(status, (s) => s?.decks[index].trackId ?? null);
  const ready = useStore(status, (s) => s?.decks[index].waveform === "ready");

  useEffect(() => {
    if (ready && trackId !== null) void ensureWaveform(trackId);
  }, [ready, trackId]);

  useEffect(
    () =>
      onFrame(() => {
        const ctx = context2d(ref.current);
        const canvas = ref.current;
        if (!ctx || !canvas) return;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        const d = status.get()?.decks[index];
        const wave = d?.trackId != null ? waveforms.get().get(d.trackId) : undefined;
        const mid = h / 2;
        const pos = livePosition(index);
        const pxPerSec = w / (2 * HALF_WINDOW);
        const toX = (t: number): number => w / 2 + (t - pos) * pxPerSec;
        if (d && wave) {
          if (d.loopIn !== null && d.loopOut !== null) {
            ctx.globalAlpha = d.loopActive ? 0.18 : 0.12;
            ctx.fillStyle = d.loopActive ? cssColor("--color-accent") : cssColor("--color-text-muted");
            ctx.fillRect(toX(d.loopIn), 0, (d.loopOut - d.loopIn) * pxPerSec, h);
            ctx.globalAlpha = 1;
          }
          const low = cssColor("--color-accent-2");
          const midC = cssColor("--color-accent");
          const high = cssColor("--color-text");
          for (let x = 0; x < w; x++) {
            const t = pos + (x - w / 2) / pxPerSec;
            const b = Math.floor(t * wave.binsPerSecond);
            if (b < 0 || b >= wave.count) continue;
            const o = b * 4;
            const amp = ((wave.bins[o] ?? 0) / 255) * (mid - 2);
            const lo = (wave.bins[o + 1] ?? 0) / 255;
            const mi = (wave.bins[o + 2] ?? 0) / 255;
            const hi = (wave.bins[o + 3] ?? 0) / 255;
            ctx.globalAlpha = x < w / 2 ? 0.55 : 1;
            ctx.fillStyle = lo >= mi && lo >= hi ? low : hi > mi ? high : midC;
            ctx.fillRect(x, mid - amp, 1, amp * 2);
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = cssColor("--color-accent-2");
          ctx.font = "bold 10px Segoe UI, sans-serif";
          d.cues.forEach((c, slot) => {
            if (c === null) return;
            const x = toX(c);
            if (x < -10 || x > w + 10) return;
            ctx.fillRect(x - 0.5, 0, 1, h);
            ctx.fillText(String(slot + 1), x + 2, 10);
          });
        } else if (d?.loaded) {
          ctx.fillStyle = cssColor("--color-text-muted");
          ctx.font = "12px Segoe UI, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(d.decodeError ?? "Reading the file…", w / 2, mid + 4);
          ctx.textAlign = "start";
        }
        // Playhead.
        ctx.fillStyle = cssColor("--color-danger");
        ctx.fillRect(w / 2 - 1, 0, 2, h);
        // Big deck letter.
        ctx.fillStyle = cssColor("--color-accent");
        ctx.font = "900 26px Segoe UI, sans-serif";
        ctx.fillText(deck, 8, mid + 9);
      }),
    [index, deck],
  );

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Deck ${deck} scrolling waveform`}
      className="h-14 w-full bg-bg"
    />
  );
}

export function TopWaveforms(): ReactNode {
  return (
    <div className="flex shrink-0 flex-col gap-px border-b border-border bg-border" aria-label="Waveforms">
      <Lane index={0} />
      <Lane index={1} />
    </div>
  );
}
