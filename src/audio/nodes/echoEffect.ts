import { clamp, rampTarget } from "../utils";

const DEFAULT_DELAY_SECONDS = 0.375;
const DEFAULT_FEEDBACK = 0.45;
const MAX_DELAY_SECONDS = 1;

export interface EchoEffect {
  readonly input: GainNode;
  /** Connect downstream (e.g. into the crossfader). */
  readonly output: GainNode;
  /** 0 = fully dry (no echo, the default/bypassed state), 1 = fully wet. */
  setWetLevel(level: number, rampSeconds?: number): void;
  dispose(): void;
}

/**
 * Delay-line echo with feedback, defaulting to fully bypassed (wet=0) so it
 * can sit permanently in a signal chain as a transparent pass-through —
 * automixController.ts's Echo-Out transition ramps setWetLevel up as a deck
 * fades out.
 */
export function createEchoEffect(
  context: BaseAudioContext,
  delaySeconds: number = DEFAULT_DELAY_SECONDS,
  feedback: number = DEFAULT_FEEDBACK,
): EchoEffect {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const delay = context.createDelay(MAX_DELAY_SECONDS);
  const feedbackGain = context.createGain();

  delay.delayTime.value = clamp(delaySeconds, 0, MAX_DELAY_SECONDS);
  feedbackGain.gain.value = clamp(feedback, 0, 0.95); // < 1 so the feedback loop can't runaway

  input.connect(dry);
  dry.connect(output);

  input.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(wet);
  wet.connect(output);

  dry.gain.value = 1;
  wet.gain.value = 0;

  function setWetLevel(level: number, rampSeconds = 0.05): void {
    const clamped = clamp(level, 0, 1);
    rampTarget(wet.gain, clamped, context, rampSeconds);
    rampTarget(dry.gain, 1 - clamped, context, rampSeconds);
  }

  function dispose(): void {
    input.disconnect();
    output.disconnect();
    dry.disconnect();
    wet.disconnect();
    delay.disconnect();
    feedbackGain.disconnect();
  }

  return { input, output, setWetLevel, dispose };
}
