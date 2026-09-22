/**
 * Audio file decoding: browser decodeAudioData first (MP3, WAV, AAC, M4A —
 * natively supported by WebView2's Media Foundation backend per AGENTS.md
 * §6), falling back to the Rust `decode_audio` command (FLAC, OGG/Vorbis —
 * formats WebView2 cannot decode) via src-tauri/src/commands/audio.rs.
 */

import { getAudioContext } from "./context";
import { callCommand } from "../services/ipc";

export interface DecodedAudio {
  readonly audioBuffer: AudioBuffer;
  readonly duration: number;
  readonly sampleRate: number;
}

interface RustDecodedAudio {
  readonly interleavedSamples: number[];
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSeconds: number;
}

/**
 * Decodes a File or ArrayBuffer into a ready-to-play AudioBuffer.
 *
 * `context` defaults to the shared main-thread singleton (AGENTS.md §5) —
 * pass an explicit context (e.g. an OfflineAudioContext) when calling this
 * from a worker, since the singleton in src/audio/context.ts is main-thread
 * only and real-time AudioContext is not reliably available in workers.
 */
export async function decodeAudioFile(
  file: File | ArrayBuffer,
  context: BaseAudioContext = getAudioContext(),
): Promise<DecodedAudio> {
  const bytes = file instanceof File ? await file.arrayBuffer() : file;

  try {
    return await decodeViaBrowser(bytes, context);
  } catch (browserError) {
    const ext = inferExtension(file, bytes);
    try {
      return await decodeViaRust(bytes, ext, context);
    } catch (rustError) {
      const browserMessage =
        browserError instanceof Error ? browserError.message : String(browserError);
      const rustMessage = rustError instanceof Error ? rustError.message : String(rustError);
      throw new Error(
        `Failed to decode audio (browser decode: ${browserMessage}; Rust fallback: ${rustMessage})`,
        { cause: rustError },
      );
    }
  }
}

export async function decodeViaBrowser(
  bytes: ArrayBuffer,
  context: BaseAudioContext,
): Promise<DecodedAudio> {
  const audioBuffer = await context.decodeAudioData(bytes.slice(0));
  return {
    audioBuffer,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
  };
}

async function decodeViaRust(
  bytes: ArrayBuffer,
  ext: string,
  context: BaseAudioContext,
): Promise<DecodedAudio> {
  const result = await callCommand<RustDecodedAudio>("decode_audio", {
    bytes: Array.from(new Uint8Array(bytes)),
    ext,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return rustPayloadToDecodedAudio(result.data, context);
}

function rustPayloadToDecodedAudio(
  payload: RustDecodedAudio,
  context: BaseAudioContext,
): DecodedAudio {
  const { interleavedSamples, sampleRate, channels, durationSeconds } = payload;
  const safeChannels = Math.max(channels, 1);
  const frameCount = Math.max(Math.floor(interleavedSamples.length / safeChannels), 1);
  const audioBuffer = context.createBuffer(safeChannels, frameCount, sampleRate);

  for (let channel = 0; channel < safeChannels; channel++) {
    const channelData = new Float32Array(frameCount);
    for (let frame = 0; frame < frameCount; frame++) {
      channelData[frame] = interleavedSamples[frame * safeChannels + channel] ?? 0;
    }
    audioBuffer.copyToChannel(channelData, channel);
  }

  return { audioBuffer, duration: durationSeconds, sampleRate };
}

function inferExtension(file: File | ArrayBuffer, bytes: ArrayBuffer): string {
  if (file instanceof File) {
    const dotIndex = file.name.lastIndexOf(".");
    if (dotIndex !== -1) {
      return file.name.slice(dotIndex + 1).toLowerCase();
    }
  }
  return sniffExtension(bytes);
}

function sniffExtension(bytes: ArrayBuffer): string {
  const header = new Uint8Array(bytes.slice(0, 4));
  const magic = Array.from(header, (byte) => String.fromCharCode(byte)).join("");
  if (magic === "fLaC") return "flac";
  if (magic === "OggS") return "ogg";
  if (magic === "RIFF") return "wav";
  return "";
}
