/**
 * Factory mapping for a 2-deck Pioneer DDJ-400.
 *
 * Status and note/CC numbers follow Pioneer's MIDI message list: deck A is
 * channel 1 (0x9n / 0xBn), deck B is channel 2, and the performance pads use
 * channels 8–11 so Shift is a different status rather than a held modifier.
 * Sync, loop, browse, load, beat FX, headphone cue, and trim are omitted —
 * they have no DeckAction variant, and unmapped bytes produce no action.
 */

import type { ControlBinding, ControllerMapping, DeckId, EqBand, PadIndex } from "./types";

const MIXER_STATUS = 0xb6;

const PAD_INDEXES: readonly PadIndex[] = [1, 2, 3, 4, 5, 6, 7, 8];

const EQ_CCS: readonly { readonly band: EqBand; readonly msb: number; readonly lsb: number }[] = [
  { band: "high", msb: 0x07, lsb: 0x27 },
  { band: "mid", msb: 0x0b, lsb: 0x2b },
  { band: "low", msb: 0x0f, lsb: 0x2f },
];

interface DeckChannels {
  readonly deck: DeckId;
  readonly noteStatus: number;
  readonly ccStatus: number;
  readonly padStatus: number;
  readonly padShiftStatus: number;
  readonly filterMsb: number;
  readonly filterLsb: number;
}

const DECKS: readonly DeckChannels[] = [
  {
    deck: "a",
    noteStatus: 0x90,
    ccStatus: 0xb0,
    padStatus: 0x97,
    padShiftStatus: 0x98,
    filterMsb: 0x17,
    filterLsb: 0x37,
  },
  {
    deck: "b",
    noteStatus: 0x91,
    ccStatus: 0xb1,
    padStatus: 0x99,
    padShiftStatus: 0x9a,
    filterMsb: 0x18,
    filterLsb: 0x38,
  },
];

function padRow(
  deck: DeckId,
  status: number,
  firstNote: number,
  action: "hotcue" | "sampler",
  shifted: boolean,
): ControlBinding[] {
  return PAD_INDEXES.map((pad) => ({
    kind: "pad",
    status,
    data1: firstNote + (pad - 1),
    deck,
    pad,
    shifted,
    action,
  }));
}

function deckBindings(channels: DeckChannels): ControlBinding[] {
  const { deck, noteStatus, ccStatus, padStatus, padShiftStatus, filterMsb, filterLsb } = channels;
  const eq: ControlBinding[] = EQ_CCS.map((band) => ({
    kind: "absolute14",
    control: "eq",
    deck,
    band: band.band,
    msb: { status: ccStatus, data1: band.msb },
    lsb: { status: ccStatus, data1: band.lsb },
  }));

  return [
    { kind: "button", status: noteStatus, data1: 0x0b, deck, action: "play" },
    { kind: "button", status: noteStatus, data1: 0x0c, deck, action: "cue" },
    {
      kind: "pitch14",
      deck,
      msb: { status: ccStatus, data1: 0x00 },
      lsb: { status: ccStatus, data1: 0x20 },
    },
    { kind: "jog", status: ccStatus, data1: 0x22, deck, mode: "scratch", encoding: "wrapped" },
    { kind: "jog", status: ccStatus, data1: 0x23, deck, mode: "bend", encoding: "center64" },
    { kind: "jog", status: ccStatus, data1: 0x21, deck, mode: "bend", encoding: "center64" },
    { kind: "jog", status: ccStatus, data1: 0x29, deck, mode: "search", encoding: "center64" },
    ...eq,
    {
      kind: "absolute14",
      control: "volume",
      deck,
      band: null,
      msb: { status: ccStatus, data1: 0x13 },
      lsb: { status: ccStatus, data1: 0x33 },
    },
    {
      kind: "absolute14",
      control: "filter",
      deck,
      band: null,
      msb: { status: MIXER_STATUS, data1: filterMsb },
      lsb: { status: MIXER_STATUS, data1: filterLsb },
    },
    ...padRow(deck, padStatus, 0x00, "hotcue", false),
    ...padRow(deck, padShiftStatus, 0x00, "hotcue", true),
    ...padRow(deck, padStatus, 0x30, "sampler", false),
    ...padRow(deck, padShiftStatus, 0x30, "sampler", true),
  ];
}

const CROSSFADER: ControlBinding = {
  kind: "absolute14",
  control: "crossfade",
  deck: null,
  band: null,
  msb: { status: MIXER_STATUS, data1: 0x1f },
  lsb: { status: MIXER_STATUS, data1: 0x3f },
};

export const DDJ400_PROFILE: ControllerMapping = {
  id: "pioneer-ddj-400",
  name: "Pioneer DDJ-400",
  controls: [...DECKS.flatMap(deckBindings), CROSSFADER],
};
