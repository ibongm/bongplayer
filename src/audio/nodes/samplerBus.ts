import { dbToGain, rampTarget } from "../utils";

const VOICE_COUNT = 8;

export interface SamplerVoice {
  readonly index: number;
  /** The sample's AudioBufferSourceNode connects here on each trigger. */
  readonly input: GainNode;
  setGain(db: number, rampSeconds?: number): void;
  dispose(): void;
}

export interface SamplerBus {
  readonly voices: readonly SamplerVoice[];
  /** Sums all voices; connect to masterLimiter's pre-limiter input. */
  readonly output: GainNode;
  dispose(): void;
}

/** Dedicated 8-voice sample bus, one gain-controlled voice per CuePadMatrix slot. */
export function createSamplerBus(
  context: BaseAudioContext,
  voiceCount: number = VOICE_COUNT,
): SamplerBus {
  const output = context.createGain();

  const voices: SamplerVoice[] = Array.from({ length: voiceCount }, (_, index) => {
    const input = context.createGain();
    input.gain.value = dbToGain(0); // initial state, before any audio flows — see musicBus.ts
    input.connect(output);

    function setGain(db: number, rampSeconds = 0.02): void {
      rampTarget(input.gain, dbToGain(db), context, rampSeconds);
    }

    function dispose(): void {
      input.disconnect();
    }

    return { index, input, setGain, dispose };
  });

  function dispose(): void {
    voices.forEach((voice) => voice.dispose());
    output.disconnect();
  }

  return { voices, output, dispose };
}
