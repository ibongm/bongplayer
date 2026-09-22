/**
 * Waveform peak extraction. Pure functions operating on an already-decoded
 * AudioBuffer — no AudioContext dependency beyond what decodeAndExtractPeaks
 * needs to call decodeAudioData, so this module works identically whether
 * called from the main thread (real-time AudioContext) or a worker
 * (OfflineAudioContext) — see src/workers/waveform.worker.ts.
 */

export interface WaveformPeaks {
  /** Interleaved [min0, max0, min1, max1, ...], length = outputWidth * 2. */
  readonly peaks: Float32Array;
  readonly duration: number;
}

/**
 * Extracts one [min, max] sample-amplitude pair per output pixel, summarizing
 * across all channels (a mono overview waveform). `outputWidth` is the
 * target canvas width in pixels.
 */
export function extractPeaks(buffer: AudioBuffer, outputWidth: number): WaveformPeaks {
  const width = Math.max(1, Math.floor(outputWidth));
  const peaks = new Float32Array(width * 2);
  const channelCount = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const samplesPerPixel = frameCount / width;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    channels.push(buffer.getChannelData(channel));
  }

  for (let pixel = 0; pixel < width; pixel++) {
    const startFrame = Math.floor(pixel * samplesPerPixel);
    const endFrame = Math.min(frameCount, Math.floor((pixel + 1) * samplesPerPixel));
    let min = 0;
    let max = 0;
    for (let frame = startFrame; frame < endFrame; frame++) {
      for (const data of channels) {
        const sample = data[frame];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
    }
    peaks[pixel * 2] = min;
    peaks[pixel * 2 + 1] = max;
  }

  return { peaks, duration: buffer.duration };
}

/**
 * Decodes raw audio bytes and extracts peaks in one step — the pipeline
 * src/workers/waveform.worker.ts runs off the main thread. Takes an explicit
 * context (rather than the shared singleton) so it works with any
 * BaseAudioContext: the real-time singleton on the main thread, or a
 * throwaway OfflineAudioContext inside a worker (AGENTS.md §5: prefer
 * OfflineAudioContext for non-realtime analysis work like this).
 */
export async function decodeAndExtractPeaks(
  bytes: ArrayBuffer,
  outputWidth: number,
  context: BaseAudioContext,
): Promise<WaveformPeaks> {
  // decodeAudioData takes a copy in modern engines, but slice defensively so
  // a caller holding onto `bytes` elsewhere is never at risk of detachment.
  const audioBuffer = await context.decodeAudioData(bytes.slice(0));
  return extractPeaks(audioBuffer, outputWidth);
}
