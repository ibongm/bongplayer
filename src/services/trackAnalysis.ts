import AudioAnalysisWorker from "../workers/audioAnalysis.worker.ts?worker";
import type { AudioAnalysisResponse } from "../workers/audioAnalysis.worker";
import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import type { DeckId } from "../types/deck";

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

// This caller only needs bpm/key, not the peaks — a minimal width keeps the
// unused computation cheap without adding an "optional peaks" branch to the
// worker's response contract (which other future callers may still want).
const UNUSED_PEAK_RESOLUTION = 1;

/**
 * Kicks off background BPM/Camelot-key analysis (Phase 7) for a just-loaded
 * track, patching the result into the deck store once done. `bytes` is
 * transferred to the worker (zero-copy) — pass a copy if the caller still
 * needs the original buffer afterward.
 */
export function analyzeTrackInBackground(deck: DeckId, bytes: ArrayBuffer, filePath: string): void {
  const worker = new AudioAnalysisWorker();

  worker.onmessage = (event: MessageEvent<AudioAnalysisResponse>) => {
    const { bpm, key, error } = event.data;
    if (error === undefined) {
      deckStoreFor(deck).getState().setTrackAnalysis(filePath, bpm, key);
    } else {
      console.error(`Background analysis failed for "${filePath}":`, error);
    }
    worker.terminate();
  };

  worker.onerror = (event) => {
    console.error(`Background analysis worker error for "${filePath}":`, event.message);
    worker.terminate();
  };

  worker.postMessage({ bytes, outputWidth: UNUSED_PEAK_RESOLUTION }, [bytes]);
}
