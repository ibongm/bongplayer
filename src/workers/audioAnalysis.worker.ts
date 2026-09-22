/**
 * Background BPM/key detection + peak calculation (AGENTS §3,
 * workers/audioAnalysis.worker.ts). Imported via Vite's `?worker` syntax,
 * same pattern as waveform.worker.ts — see that file for the worker-scope
 * postMessage/onmessage typing note (DOM lib vs WebWorker lib) and for why
 * this takes raw bytes rather than a File (this app never has one).
 *
 * Only browser-decodable formats work here for the same reason as
 * waveform.worker.ts: Tauri IPC (the Rust FLAC/OGG fallback) isn't
 * reachable from a worker.
 */

import { decodeViaBrowser } from "../audio/decode";
import { extractPeaks } from "../audio/waveform";
import { monoDownmix } from "../audio/analysis/pcm";
import { detectBpm } from "../audio/analysis/bpmDetection";
import { detectKey } from "../audio/analysis/keyDetection";

export interface AudioAnalysisRequest {
  readonly bytes: ArrayBuffer;
  readonly outputWidth: number;
}

export interface AudioAnalysisResponse {
  readonly peaks: Float32Array;
  readonly duration: number;
  readonly bpm: number;
  readonly key: string;
  readonly error?: string;
}

async function handleRequest(request: AudioAnalysisRequest): Promise<AudioAnalysisResponse> {
  try {
    const context = new OfflineAudioContext(1, 1, 44100);
    const decoded = await decodeViaBrowser(request.bytes, context);
    const { peaks } = extractPeaks(decoded.audioBuffer, request.outputWidth);
    const mono = monoDownmix(decoded.audioBuffer);

    return {
      peaks,
      duration: decoded.duration,
      bpm: detectBpm(mono, decoded.sampleRate),
      key: detectKey(mono, decoded.sampleRate),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { peaks: new Float32Array(0), duration: 0, bpm: 0, key: "", error: message };
  }
}

interface WorkerScopeMessaging {
  postMessage(message: AudioAnalysisResponse, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<AudioAnalysisRequest>) => void,
  ): void;
}
const workerScope = self as unknown as WorkerScopeMessaging;

workerScope.addEventListener("message", (event) => {
  void handleRequest(event.data).then((response) => {
    workerScope.postMessage(response, [response.peaks.buffer]);
  });
});
