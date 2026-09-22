import { useMemo } from "react";
import { WaveformCanvas } from "./WaveformCanvas";
import { extractPeaks, windowPeaks } from "../../audio/waveform";
import { getMasterGraph, deckEngineFor } from "../../audio/masterGraph";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import type { DeckId } from "../../types/deck";

const WINDOW_SECONDS = 10;
const PEAK_RESOLUTION_PER_SECOND = 20;

interface DeckWaveformProps {
  readonly deck: DeckId;
}

function DeckWaveform({ deck }: DeckWaveformProps) {
  const store = deck === "a" ? useDeckAStore : useDeckBStore;
  const track = store((state) => state.track);
  const currentTime = store((state) => state.currentTimeSeconds);
  const hotCues = store((state) => state.hotCues);

  const fullPeaks = useMemo(() => {
    if (track === null) return null;
    const buffer = deckEngineFor(getMasterGraph(), deck).getBuffer();
    if (buffer === null) return null;
    const outputWidth = Math.max(1, Math.round(track.duration * PEAK_RESOLUTION_PER_SECOND));
    return extractPeaks(buffer, outputWidth).peaks;
  }, [deck, track]);

  if (track === null || fullPeaks === null) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-textMuted">
        Deck {deck.toUpperCase()} — no track loaded
      </div>
    );
  }

  const window = windowPeaks(fullPeaks, track.duration, currentTime, WINDOW_SECONDS);
  const windowStartSeconds = currentTime - window.playheadInWindowSeconds;
  const hotCuesInWindow = hotCues
    .map((cue) => cue.positionSeconds - windowStartSeconds)
    .filter((position) => position >= 0 && position <= window.windowDurationSeconds);

  return (
    <WaveformCanvas
      peaks={window.peaks}
      playhead={window.playheadInWindowSeconds}
      duration={window.windowDurationSeconds}
      hotCues={hotCuesInWindow}
    />
  );
}

/** Dual full-width, centered-playhead scrolling waveforms for Deck A/B (AGENTS §3, waveforms/ScrollingWaveforms.tsx). */
export function ScrollingWaveforms() {
  return (
    <div className="flex h-full w-full flex-col gap-px bg-white/10">
      <div className="min-h-0 flex-1 bg-surface">
        <DeckWaveform deck="a" />
      </div>
      <div className="min-h-0 flex-1 bg-surface">
        <DeckWaveform deck="b" />
      </div>
    </div>
  );
}
