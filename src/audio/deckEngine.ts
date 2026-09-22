/**
 * Per-deck playback engine: owns the decoded AudioBuffer for the loaded
 * track and the Phase 2 node chain (musicBus -> threeBandEQ -> bipolarFilter)
 * a deck's audio actually flows through. Deliberately not a React hook or
 * store slice — AGENTS §5 ("Clean Effects"): graph mutations live in a
 * dedicated service, not inside component renders. See
 * src/hooks/useDeckController.ts for the React-facing bridge.
 *
 * AudioBufferSourceNode is one-shot per the Web Audio spec, so pause/seek
 * work by tearing down and recreating the source node at the right buffer
 * offset — the standard pattern, tracked via (startedAtContextTime,
 * startOffsetSeconds) rather than any native "current position" API (none
 * exists for AudioBufferSourceNode).
 */

import { getAudioContext } from "./context";
import { dbToGain, rampTarget } from "./utils";
import { createMusicBus, type MusicBus } from "./nodes/musicBus";
import { createThreeBandEQ, type ThreeBandEQ } from "./nodes/threeBandEQ";
import { createBipolarFilter, type BipolarFilter } from "./nodes/bipolarFilter";
import type { DeckId } from "../types/deck";

const TRIM_MIN_DB = -12;
const TRIM_MAX_DB = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface DeckEngine {
  readonly deck: DeckId;
  readonly musicBus: MusicBus;
  readonly eq: ThreeBandEQ;
  readonly filter: BipolarFilter;
  /** Connect this downstream (into the crossfader). */
  readonly output: AudioNode;
  loadBuffer(buffer: AudioBuffer): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setPlaybackRate(rate: number): void;
  /** Input gain staging, applied before the EQ (AGENTS-style channel strip: Trim -> EQ -> Filter -> Fader). */
  setTrimDb(db: number): void;
  /** The channel's volume fader, applied after the filter, before the crossfader. */
  setVolumeFader(level: number): void;
  getCurrentTime(): number;
  isPlaying(): boolean;
  /** The currently loaded track's decoded buffer (for waveform peak extraction), or null if none is loaded. */
  getBuffer(): AudioBuffer | null;
  dispose(): void;
}

export function createDeckEngine(deck: DeckId): DeckEngine {
  const context = getAudioContext();
  const trimGain = context.createGain();
  const musicBus = createMusicBus(context);
  const eq = createThreeBandEQ(context);
  const filter = createBipolarFilter(context);
  const volumeFaderGain = context.createGain();

  trimGain.connect(musicBus.input);
  musicBus.output.connect(eq.input);
  eq.output.connect(filter.node);
  filter.node.connect(volumeFaderGain);

  let buffer: AudioBuffer | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;
  let playbackRate = 1;
  let startedAtContextTime = 0;
  let startOffsetSeconds = 0;
  let playing = false;

  function stopSourceNode(): void {
    if (sourceNode === null) return;
    const node = sourceNode;
    sourceNode = null;
    node.onended = null;
    try {
      node.stop();
    } catch {
      // Already stopped/never started — fine to ignore.
    }
    node.disconnect();
  }

  function getCurrentTime(): number {
    if (buffer === null) return 0;
    if (!playing) return startOffsetSeconds;
    const elapsed = (context.currentTime - startedAtContextTime) * playbackRate;
    return Math.min(buffer.duration, startOffsetSeconds + elapsed);
  }

  function startFrom(offsetSeconds: number): void {
    if (buffer === null) return;
    stopSourceNode();
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = playbackRate;
    node.connect(trimGain);
    node.onended = () => {
      if (sourceNode === node) {
        playing = false;
        sourceNode = null;
      }
    };
    node.start(0, Math.max(0, offsetSeconds));
    sourceNode = node;
    startedAtContextTime = context.currentTime;
    startOffsetSeconds = offsetSeconds;
    playing = true;
  }

  function loadBuffer(newBuffer: AudioBuffer): void {
    stopSourceNode();
    buffer = newBuffer;
    playing = false;
    startOffsetSeconds = 0;
    startedAtContextTime = context.currentTime;
  }

  function play(): void {
    if (buffer === null || playing) return;
    startFrom(getCurrentTime());
  }

  function pause(): void {
    if (!playing) return;
    const position = getCurrentTime();
    stopSourceNode();
    startOffsetSeconds = position;
    playing = false;
  }

  function stop(): void {
    stopSourceNode();
    startOffsetSeconds = 0;
    playing = false;
  }

  function seek(seconds: number): void {
    const clamped = buffer === null ? 0 : Math.min(Math.max(seconds, 0), buffer.duration);
    if (playing) {
      startFrom(clamped);
    } else {
      startOffsetSeconds = clamped;
    }
  }

  function setPlaybackRate(rate: number): void {
    const position = getCurrentTime(); // uses the OLD rate — must read before mutating it below.
    playbackRate = rate;
    if (sourceNode !== null) {
      sourceNode.playbackRate.value = rate;
    }
    startOffsetSeconds = position;
    startedAtContextTime = context.currentTime;
  }

  function isPlaying(): boolean {
    return playing;
  }

  function getBuffer(): AudioBuffer | null {
    return buffer;
  }

  function setTrimDb(db: number): void {
    rampTarget(trimGain.gain, dbToGain(clamp(db, TRIM_MIN_DB, TRIM_MAX_DB)), context);
  }

  function setVolumeFader(level: number): void {
    rampTarget(volumeFaderGain.gain, clamp(level, 0, 1), context);
  }

  function dispose(): void {
    stopSourceNode();
    trimGain.disconnect();
    musicBus.dispose();
    eq.dispose();
    filter.dispose();
    volumeFaderGain.disconnect();
  }

  return {
    deck,
    musicBus,
    eq,
    filter,
    output: volumeFaderGain,
    loadBuffer,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
    setTrimDb,
    setVolumeFader,
    getCurrentTime,
    isPlaying,
    getBuffer,
    dispose,
  };
}
