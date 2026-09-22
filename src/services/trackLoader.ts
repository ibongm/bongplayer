import { readFile } from "@tauri-apps/plugin-fs";
import { decodeAudioFile } from "../audio/decode";
import type { TrackMetadata } from "../store/createDeckStore";

export interface DecodedTrack {
  readonly metadata: TrackMetadata;
  readonly audioBuffer: AudioBuffer;
}

function titleFromFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
}

/**
 * Reads a file from disk and decodes it, returning both deck-ready
 * TrackMetadata and the decoded AudioBuffer (needed by the deck engine for
 * actual playback — see src/audio/deckEngine.ts). Title defaults to the
 * filename (no ID3/Vorbis-comment tag reading yet); bpm/key stay null
 * until Phase 7's analysis worker populates them.
 */
export async function decodeTrack(filePath: string, fileName: string): Promise<DecodedTrack> {
  const bytes = await readFile(filePath);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const decoded = await decodeAudioFile(arrayBuffer);

  const metadata: TrackMetadata = {
    filePath,
    title: titleFromFileName(fileName),
    artist: null,
    duration: decoded.duration,
    bpm: null,
    key: null,
    sampleRate: decoded.sampleRate,
  };

  return { metadata, audioBuffer: decoded.audioBuffer };
}

/** Convenience for callers that only need the metadata (e.g. automix queue duration lookup). */
export async function loadTrackMetadata(
  filePath: string,
  fileName: string,
): Promise<TrackMetadata> {
  return (await decodeTrack(filePath, fileName)).metadata;
}
