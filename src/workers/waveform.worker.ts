/**
 * Background decode + peak extraction, off the main thread (AGENTS.md §5:
 * worker isolation for heavy decoding/peaks). Imported via Vite's `?worker`
 * syntax, e.g.:
 *   import WaveformWorker from "./workers/waveform.worker.ts?worker";
 *   const worker = new WaveformWorker();
 *
 * Takes raw bytes rather than a File: this app never actually has a
 * browser File object anywhere (tracks are loaded by path via
 * @tauri-apps/plugin-fs's readFile(), and native OS drag-drop hands back
 * paths too — see src/services/dragAndDrop.ts's DragDropEvent handling) —
 * an earlier version of this file assumed a File was available, which it
 * never is in practice.
 *
 * Only browser-decodable formats (MP3/WAV/AAC/M4A) work here: Tauri's IPC
 * bridge is window-scoped, so the Rust decode_audio fallback used by
 * src/audio/decode.ts on the main thread is not reachable from a worker.
 * FLAC/OGG files report back an error; the caller should retry those via
 * decodeAudioFile() on the main thread instead.
 */

import { decodeAndExtractPeaks } from "../audio/waveform";

export interface WaveformWorkerRequest {
  readonly bytes: ArrayBuffer;
  readonly outputWidth: number;
}

export interface WaveformWorkerResponse {
  readonly peaks: Float32Array;
  readonly duration: number;
  readonly error?: string;
}

async function handleRequest(request: WaveformWorkerRequest): Promise<WaveformWorkerResponse> {
  try {
    // A throwaway OfflineAudioContext, not the main-thread singleton (which
    // isn't reachable from a worker anyway) — no audio output needed here,
    // only decodeAudioData's decoding capability.
    const context = new OfflineAudioContext(1, 1, 44100);
    const { peaks, duration } = await decodeAndExtractPeaks(
      request.bytes,
      request.outputWidth,
      context,
    );
    return { peaks, duration };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { peaks: new Float32Array(0), duration: 0, error: message };
  }
}

// TypeScript's "DOM" lib types self.postMessage/onmessage after Window's
// signature (targetOrigin required), not DedicatedWorkerGlobalScope's — and
// the "WebWorker" lib that would fix that doesn't define the Web Audio API
// types this file needs (AudioBuffer, OfflineAudioContext, ...), which only
// exist under "DOM". Rather than mixing the two conflicting lib sets, cast
// narrowly at just this one call site to the worker-scope signature.
interface WorkerScopeMessaging {
  postMessage(message: WaveformWorkerResponse, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WaveformWorkerRequest>) => void,
  ): void;
}
const workerScope = self as unknown as WorkerScopeMessaging;

workerScope.addEventListener("message", (event) => {
  void handleRequest(event.data).then((response) => {
    workerScope.postMessage(response, [response.peaks.buffer]);
  });
});
