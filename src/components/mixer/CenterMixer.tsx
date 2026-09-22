import { useEffect, useMemo, useRef } from "react";
import { getMasterGraph } from "../../audio/masterGraph";
import { useMixerStore } from "../../store/useMixerStore";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useDeckController } from "../../hooks/useDeckController";
import type { CrossfaderCurve } from "../../utils/audioMath";

interface VuMeterProps {
  readonly analyser: AnalyserNode;
}

function VuMeter({ analyser }: VuMeterProps) {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const buffer = new Float32Array(analyser.fftSize);
    let frameId: number;
    function tick(): void {
      analyser.getFloatTimeDomainData(buffer);
      let sumSquares = 0;
      for (const sample of buffer) sumSquares += sample * sample;
      const rms = Math.sqrt(sumSquares / buffer.length);
      const level = Math.min(1, rms * 1.4); // slight scaling so a healthy mix visibly fills the meter
      if (barRef.current !== null) {
        barRef.current.style.height = `${(level * 100).toFixed(1)}%`;
      }
      frameId = requestAnimationFrame(tick);
    }
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [analyser]);

  return (
    <div className="relative h-24 w-2 overflow-hidden rounded bg-surface">
      <div
        ref={barRef}
        className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-500"
        style={{ height: "0%" }}
      />
    </div>
  );
}

const CROSSFADER_CURVES: readonly { readonly value: CrossfaderCurve; readonly label: string }[] = [
  { value: "constantPower", label: "Const. Power" },
  { value: "linear", label: "Linear" },
  { value: "sharpCut", label: "Sharp Cut" },
];

/**
 * Stereo VU meters, crossfader, and a master transport bar (AGENTS §3,
 * mixer/CenterMixer.tsx). "Master" transport is interpreted as driving both
 * decks together (there's no single shared transport concept in the spec
 * beyond this component) — Play starts whichever deck(s) have a track
 * loaded, Pause/Stop apply to both.
 */
export function CenterMixer() {
  const graph = useMemo(() => getMasterGraph(), []);
  const crossfaderPosition = useMixerStore((state) => state.crossfaderPosition);
  const setCrossfaderPosition = useMixerStore((state) => state.setCrossfaderPosition);
  const crossfaderCurve = useMixerStore((state) => state.crossfaderCurve);
  const setCrossfaderCurve = useMixerStore((state) => state.setCrossfaderCurve);

  const deckAController = useDeckController("a");
  const deckBController = useDeckController("b");
  const deckATrackLoaded = useDeckAStore((state) => state.track !== null);
  const deckBTrackLoaded = useDeckBStore((state) => state.track !== null);

  function handleMasterPlay(): void {
    if (deckATrackLoaded) deckAController.play();
    if (deckBTrackLoaded) deckBController.play();
  }

  function handleMasterPause(): void {
    deckAController.pause();
    deckBController.pause();
  }

  function handleMasterStop(): void {
    deckAController.stop();
    deckBController.stop();
  }

  return (
    <div className="flex flex-col items-center gap-3 p-2">
      <div className="flex gap-3">
        <VuMeter analyser={graph.vu.left} />
        <VuMeter analyser={graph.vu.right} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleMasterPlay}
          className="rounded bg-accent/20 px-3 py-1 text-xs text-accent hover:bg-accent/30"
        >
          Play
        </button>
        <button
          type="button"
          onClick={handleMasterPause}
          className="rounded bg-surfaceRaised px-3 py-1 text-xs text-textPrimary hover:bg-white/10"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={handleMasterStop}
          className="rounded bg-surfaceRaised px-3 py-1 text-xs text-textPrimary hover:bg-white/10"
        >
          Stop
        </button>
      </div>

      <div className="flex w-full flex-col items-center gap-1">
        <select
          value={crossfaderCurve}
          onChange={(event) => setCrossfaderCurve(event.target.value as CrossfaderCurve)}
          className="rounded bg-surface px-1 py-0.5 text-[10px] text-textPrimary"
        >
          {CROSSFADER_CURVES.map((curve) => (
            <option key={curve.value} value={curve.value}>
              {curve.label}
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={crossfaderPosition}
          onChange={(event) => setCrossfaderPosition(Number(event.target.value))}
          className="w-40 accent-accent"
        />
      </div>
    </div>
  );
}
