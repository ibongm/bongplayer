/**
 * Assembles the shared audio graph Phase 2's node modules anticipated but
 * never wired together: two deck engines -> equal-power crossfader ->
 * master limiter -> destination, with the sampler bus tapped in
 * pre-limiter (per masterLimiter.ts's own doc comment) and a PFL/cue bus
 * for headphone monitoring. Lazily constructed on first access, like
 * getAudioContext() — must not run until a user gesture has resumed the
 * shared AudioContext (AGENTS §5).
 */

import { getAudioContext } from "./context";
import { dbToGain, rampTarget } from "./utils";
import { createDeckEngine, type DeckEngine } from "./deckEngine";
import { createEqualPowerCrossfade, type EqualPowerCrossfade } from "./nodes/equalPower";
import { createMasterLimiter, type MasterLimiter } from "./nodes/masterLimiter";
import { createSamplerBus, type SamplerBus } from "./nodes/samplerBus";
import { createPflBus, type PflBus } from "./nodes/pflBus";
import { createSilenceWatchdog, type SilenceWatchdog } from "./nodes/silenceWatchdog";

export interface MasterGraph {
  readonly deckA: DeckEngine;
  readonly deckB: DeckEngine;
  readonly crossfade: EqualPowerCrossfade;
  readonly masterLimiter: MasterLimiter;
  readonly samplerBus: SamplerBus;
  readonly pflBus: PflBus;
  readonly silenceWatchdog: SilenceWatchdog;
  /** Post-limiter master volume — useMixerStore's masterGainDb applies here. */
  readonly masterGain: GainNode;
  /** True per-channel stereo VU metering (a ChannelSplitterNode feeding two separate analysers — a single AnalyserNode only exposes a downmixed view). */
  readonly vu: { readonly left: AnalyserNode; readonly right: AnalyserNode };
  setMasterGainDb(db: number): void;
}

let sharedGraph: MasterGraph | null = null;

export function getMasterGraph(): MasterGraph {
  if (sharedGraph !== null) return sharedGraph;

  const context = getAudioContext();
  const deckA = createDeckEngine("a");
  const deckB = createDeckEngine("b");
  const crossfade = createEqualPowerCrossfade(context);
  const masterLimiter = createMasterLimiter(context);
  const samplerBus = createSamplerBus(context);
  const pflBus = createPflBus(context);
  const silenceWatchdog = createSilenceWatchdog(context);
  const masterGain = context.createGain();
  const vuSplitter = context.createChannelSplitter(2);
  const vuLeft = context.createAnalyser();
  const vuRight = context.createAnalyser();
  vuLeft.fftSize = 1024;
  vuRight.fftSize = 1024;

  deckA.output.connect(crossfade.gainA);
  deckB.output.connect(crossfade.gainB);
  crossfade.output.connect(masterLimiter.input);
  samplerBus.output.connect(masterLimiter.input);
  masterLimiter.output.connect(masterGain);
  masterGain.connect(context.destination);
  masterGain.connect(silenceWatchdog.analyser);
  masterGain.connect(vuSplitter);
  vuSplitter.connect(vuLeft, 0);
  vuSplitter.connect(vuRight, 1);

  function setMasterGainDb(db: number): void {
    rampTarget(masterGain.gain, dbToGain(db), context);
  }

  sharedGraph = {
    deckA,
    deckB,
    crossfade,
    masterLimiter,
    samplerBus,
    pflBus,
    silenceWatchdog,
    masterGain,
    vu: { left: vuLeft, right: vuRight },
    setMasterGainDb,
  };
  return sharedGraph;
}

export function deckEngineFor(graph: MasterGraph, deck: "a" | "b"): DeckEngine {
  return deck === "a" ? graph.deckA : graph.deckB;
}
