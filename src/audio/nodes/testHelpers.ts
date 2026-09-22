import { OfflineAudioContext } from "node-web-audio-api";

export const SAMPLE_RATE = 44100;

/**
 * Renders `build` against a fresh OfflineAudioContext and returns the
 * rendered channel-0 samples, for DSP "null tests" (asserting numeric
 * properties of real rendered audio rather than mocking the graph).
 */
export async function renderMono(
  durationSeconds: number,
  build: (context: OfflineAudioContext) => void,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.ceil(durationSeconds * SAMPLE_RATE), SAMPLE_RATE);
  build(context);
  const buffer = await context.startRendering();
  return buffer.getChannelData(0);
}

export async function renderStereo(
  durationSeconds: number,
  build: (context: OfflineAudioContext) => void,
): Promise<[Float32Array, Float32Array]> {
  const context = new OfflineAudioContext(2, Math.ceil(durationSeconds * SAMPLE_RATE), SAMPLE_RATE);
  build(context);
  const buffer = await context.startRendering();
  return [buffer.getChannelData(0), buffer.getChannelData(1)];
}

export function peakAmplitude(
  samples: Float32Array,
  fromIndex = 0,
  toIndex = samples.length,
): number {
  let max = 0;
  for (let i = fromIndex; i < toIndex; i++) {
    max = Math.max(max, Math.abs(samples[i]));
  }
  return max;
}

export function connectTestOscillator(
  context: OfflineAudioContext,
  destination: AudioNode,
  frequency = 440,
  durationSeconds = 0.2,
): void {
  const osc = context.createOscillator();
  osc.frequency.setValueAtTime(frequency, context.currentTime);
  osc.connect(destination);
  osc.start(0);
  osc.stop(durationSeconds);
}
