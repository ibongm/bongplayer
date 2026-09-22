/**
 * Bidirectional LED feedback for the Pioneer DDJ-400 (Phase 7): pure
 * state -> outgoing-message mapping, mirroring ddj400Profile.ts's
 * input-side note/status numbers exactly (the DDJ-400 reuses the same note
 * number for a pad's button-press input and its LED output, just sent back
 * on the same status byte instead of received from it). Kept side-effect
 * free so it's unit-testable without a real MIDIOutput — see
 * src/services/midiOutput.ts for the store-subscription glue that actually
 * sends these over the wire.
 */

import type { HotCue, PlaybackState } from "../../store/createDeckStore";
import type { SamplerSlot } from "../../store/useSamplerStore";
import type { DeckId, SlotIndex } from "../../types/deck";
import { SLOT_INDEXES } from "../../types/deck";

export interface LedMessage {
  readonly status: number;
  readonly note: number;
  readonly velocity: number;
}

const LED_ON = 127;
const LED_OFF = 0;

const PLAY_NOTE = 0x0b;
const CUE_NOTE = 0x0c;
const HOTCUE_FIRST_NOTE = 0x00;
const SAMPLER_FIRST_NOTE = 0x30;

interface DeckLedChannels {
  readonly noteStatus: number;
  readonly padStatus: number;
}

const DECK_LED_CHANNELS: Readonly<Record<DeckId, DeckLedChannels>> = {
  a: { noteStatus: 0x90, padStatus: 0x97 },
  b: { noteStatus: 0x91, padStatus: 0x99 },
};

function padLedMessages(
  deck: DeckId,
  firstNote: number,
  isLit: (pad: SlotIndex) => boolean,
): LedMessage[] {
  const { padStatus } = DECK_LED_CHANNELS[deck];
  return SLOT_INDEXES.map((pad) => ({
    status: padStatus,
    note: firstNote + (pad - 1),
    velocity: isLit(pad) ? LED_ON : LED_OFF,
  }));
}

/** Play LED lit while playing; Cue LED lit whenever a track is loaded (stopped/paused/playing). */
export function playCueLedMessages(deck: DeckId, playbackState: PlaybackState): LedMessage[] {
  const { noteStatus } = DECK_LED_CHANNELS[deck];
  return [
    {
      status: noteStatus,
      note: PLAY_NOTE,
      velocity: playbackState === "playing" ? LED_ON : LED_OFF,
    },
    {
      status: noteStatus,
      note: CUE_NOTE,
      velocity: playbackState === "empty" ? LED_OFF : LED_ON,
    },
  ];
}

/** One hot-cue pad LED per slot, lit iff that deck has a hot cue set at that index. */
export function hotCueLedMessages(deck: DeckId, hotCues: readonly HotCue[]): LedMessage[] {
  return padLedMessages(deck, HOTCUE_FIRST_NOTE, (pad) => hotCues.some((cue) => cue.index === pad));
}

/**
 * Sampler pad LEDs, lit iff that global slot has a track loaded. The
 * sampler bank is shared across decks (see src/services/padActions.ts), so
 * this is deck-agnostic in meaning but still addressed per deck channel —
 * both decks' sampler pad rows show the same lit/unlit pattern.
 */
export function samplerLedMessages(deck: DeckId, slots: readonly SamplerSlot[]): LedMessage[] {
  return padLedMessages(
    deck,
    SAMPLER_FIRST_NOTE,
    (pad) => (slots.find((slot) => slot.index === pad)?.filePath ?? null) !== null,
  );
}
