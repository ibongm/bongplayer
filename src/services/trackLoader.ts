import { readFile } from "@tauri-apps/plugin-fs";
import { decodeAudioFile } from "../audio/decode";
import type { TrackMetadata } from "../store/createDeckStore";

function titleFromFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
}

/**
 * Reads a file from disk and decodes it into deck-ready TrackMetadata.
 * Title defaults to the filename (no ID3/Vorbis-comment tag reading yet);
 * bpm/key stay null until Phase 7's analysis worker populates them.
 */
export async function loadTrackMetadata(
  filePath: string,
  fileName: string,
): Promise<TrackMetadata> {
  const bytes = await readFile(filePath);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const decoded = await decodeAudioFile(arrayBuffer);

  return {
    filePath,
    title: titleFromFileName(fileName),
    artist: null,
    duration: decoded.duration,
    bpm: null,
    key: null,
    sampleRate: decoded.sampleRate,
  };
}
