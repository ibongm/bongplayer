import { dbToGain, rampTarget } from "../utils";

interface MediaStreamCapableContext {
  createMediaStreamDestination?: () => MediaStreamAudioDestinationNode;
}

interface SinkCapableElement {
  setSinkId?: (deviceId: string) => Promise<void>;
}

export interface PflBus {
  /** PFL/cue sources (deck pre-fader taps, sampler previews) sum here. */
  readonly cueBus: GainNode;
  /**
   * Tap for dual-soundcard routing via setSinkId. Only available on a real
   * AudioContext (the Web Audio spec has no createMediaStreamDestination on
   * OfflineAudioContext) — null when unsupported.
   */
  readonly mediaStreamDestination: MediaStreamAudioDestinationNode | null;
  setCueLevel(db: number, rampSeconds?: number): void;
  dispose(): void;
}

/** Headphone cue (PFL) bus. Route its output via one of the two strategies below. */
export function createPflBus(context: BaseAudioContext): PflBus {
  const cueBus = context.createGain();
  cueBus.gain.value = dbToGain(0); // initial state, before any audio flows — see musicBus.ts

  // Existence-check plus a try/catch, not just the former: some runtimes
  // (observed in node-web-audio-api, used for testing — see AGENTS §5's
  // OfflineAudioContext-for-analysis guidance) declare this method but throw
  // when it's actually called, rather than simply omitting it.
  const capableContext = context as BaseAudioContext & MediaStreamCapableContext;
  let mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  if (typeof capableContext.createMediaStreamDestination === "function") {
    try {
      mediaStreamDestination = capableContext.createMediaStreamDestination();
    } catch {
      mediaStreamDestination = null;
    }
  }
  if (mediaStreamDestination !== null) {
    cueBus.connect(mediaStreamDestination);
  }

  function setCueLevel(db: number, rampSeconds = 0.03): void {
    rampTarget(cueBus.gain, dbToGain(db), context, rampSeconds);
  }

  function dispose(): void {
    cueBus.disconnect();
    mediaStreamDestination?.disconnect();
  }

  return { cueBus, mediaStreamDestination, setCueLevel, dispose };
}

/**
 * Split-cable routing strategy: merges the master bus into the Left channel
 * and the cue bus into the Right channel of a single stereo output. A
 * physical Y-splitter cable then sends Master to the main speakers and Cue
 * to the headphones. Each input is automatically downmixed to mono by the
 * ChannelMergerNode per the Web Audio spec's default mixing rules.
 */
export function createSplitCableMerger(
  context: BaseAudioContext,
  masterBus: AudioNode,
  cueBus: AudioNode,
): ChannelMergerNode {
  const merger = context.createChannelMerger(2);
  masterBus.connect(merger, 0, 0);
  cueBus.connect(merger, 0, 1);
  return merger;
}

/**
 * Dual-soundcard routing strategy: routes a media element (fed by a
 * MediaStreamDestination tap) to a specific output device via the Audio
 * Output Devices API. Throws if the current WebView2 runtime lacks support.
 */
export async function routeElementToOutputDevice(
  element: HTMLMediaElement,
  deviceId: string,
): Promise<void> {
  const sinkCapable = element as HTMLMediaElement & SinkCapableElement;
  if (typeof sinkCapable.setSinkId !== "function") {
    throw new Error("setSinkId is not supported in this WebView2 runtime.");
  }
  await sinkCapable.setSinkId(deviceId);
}
