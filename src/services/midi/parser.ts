/**
 * Pure MIDI → DeckAction decoder.
 *
 * 14-bit controls (pitch, EQ, filter, faders) arrive as two messages. Pass the
 * ParserState from the previous result back in. The input state is never mutated.
 * Messages shorter than 3 bytes, and anything the mapping does not name, produce
 * no action. Running status is not reconstructed.
 */

import type {
  AbsoluteBinding,
  ControlBinding,
  ControllerMapping,
  DeckAction,
  JogBinding,
  MidiMessage,
  PadBinding,
  ParseResult,
  ParserState,
  PitchBinding,
} from "./types";

const PITCH_14_CENTER = 8192;
const PITCH_14_MAX = 16383;

interface LookupEntry {
  readonly binding: ControlBinding;
  readonly role: "edge" | "msb" | "lsb" | "jog";
}

export function createParserState(): ParserState {
  return { halves: {} };
}

/** First three bytes of a channel message. Null when the buffer is shorter than that. */
export function decodeMidiBytes(bytes: Uint8Array): MidiMessage | null {
  if (bytes.length < 3) {
    return null;
  }
  return {
    status: bytes[0] & 0xff,
    data1: bytes[1] & 0x7f,
    data2: bytes[2] & 0x7f,
  };
}

/**
 * Vinyl-platter ticks. Clockwise is 1..30. Counter-clockwise is 127..98,
 * returned as -1..-30. Any other value (including the 64 center sentinel) is 0.
 */
export function decodeWrappedJog(data2: number): number {
  const value = data2 & 0x7f;
  if (value >= 1 && value <= 30) {
    return value;
  }
  if (value >= 98 && value <= 127) {
    return value - 128;
  }
  return 0;
}

/** Side-ring and vinyl-off platter. 64 is stopped; above is clockwise. */
export function decodeCenter64Jog(data2: number): number {
  return (data2 & 0x7f) - 64;
}

export function parseMidiMessage(
  bytes: Uint8Array,
  mapping: ControllerMapping,
  state: ParserState = createParserState(),
): ParseResult {
  const message = decodeMidiBytes(bytes);
  if (message === null) {
    return { actions: [], state };
  }
  const entry = buildLookup(mapping).get(halfKey(message.status, message.data1));
  if (entry === undefined) {
    return { actions: [], state };
  }
  return dispatch(entry, message, state);
}

function dispatch(entry: LookupEntry, message: MidiMessage, state: ParserState): ParseResult {
  const binding = entry.binding;
  switch (binding.kind) {
    case "button":
      return entry.role === "edge"
        ? parseButton(binding.action, binding.deck, message, state)
        : idle(state);
    case "pad":
      return entry.role === "edge" ? parsePad(binding, message, state) : idle(state);
    case "jog":
      return entry.role === "jog" ? parseJog(binding, message, state) : idle(state);
    case "pitch14":
    case "absolute14":
      return parse14(binding, entry.role, message, state);
  }
}

function parseButton(
  action: "play" | "pause" | "cue",
  deck: "a" | "b",
  message: MidiMessage,
  state: ParserState,
): ParseResult {
  const down = noteDown(message.status, message.data2);
  if (down === null) {
    return idle(state);
  }
  return { actions: [{ type: action, deck, down }], state };
}

function parsePad(binding: PadBinding, message: MidiMessage, state: ParserState): ParseResult {
  const down = noteDown(message.status, message.data2);
  if (down === null) {
    return idle(state);
  }
  if (binding.action === "hotcue") {
    return {
      actions: [
        {
          type: "hotcue",
          deck: binding.deck,
          index: binding.pad,
          down,
          shifted: binding.shifted,
        },
      ],
      state,
    };
  }
  return {
    actions: [
      {
        type: "sampler",
        deck: binding.deck,
        slot: binding.pad,
        down,
        shifted: binding.shifted,
      },
    ],
    state,
  };
}

function parseJog(binding: JogBinding, message: MidiMessage, state: ParserState): ParseResult {
  const delta =
    binding.encoding === "wrapped"
      ? decodeWrappedJog(message.data2)
      : decodeCenter64Jog(message.data2);
  return {
    actions: [{ type: "jog", deck: binding.deck, delta, mode: binding.mode }],
    state,
  };
}

function parse14(
  binding: PitchBinding | AbsoluteBinding,
  role: LookupEntry["role"],
  message: MidiMessage,
  state: ParserState,
): ParseResult {
  if (role !== "msb" && role !== "lsb") {
    return idle(state);
  }
  const arriving = role === "msb" ? binding.msb : binding.lsb;
  const other = role === "msb" ? binding.lsb : binding.msb;
  const next = rememberHalf(state, arriving.status, arriving.data1, message.data2);
  const otherValue = next.halves[halfKey(other.status, other.data1)];
  if (otherValue === undefined) {
    return { actions: [], state: next };
  }
  const msb = role === "msb" ? message.data2 : otherValue;
  const lsb = role === "lsb" ? message.data2 : otherValue;
  const value14 = (msb << 7) | lsb;
  if (binding.kind === "pitch14") {
    return {
      actions: [
        {
          type: "pitch",
          deck: binding.deck,
          value14,
          normalized: normalizePitch(value14),
        },
      ],
      state: next,
    };
  }
  const action = absoluteAction(binding, normalizeAbsolute(value14));
  if (action === null) {
    return { actions: [], state: next };
  }
  return { actions: [action], state: next };
}

function absoluteAction(binding: AbsoluteBinding, value: number): DeckAction | null {
  switch (binding.control) {
    case "crossfade":
      return { type: "crossfade", value };
    case "volume":
      return binding.deck === null ? null : { type: "volume", deck: binding.deck, value };
    case "filter":
      return binding.deck === null ? null : { type: "filter", deck: binding.deck, value };
    case "eq":
      return binding.deck === null || binding.band === null
        ? null
        : { type: "eq", deck: binding.deck, band: binding.band, value };
  }
}

function noteDown(status: number, data2: number): boolean | null {
  const high = status & 0xf0;
  if (high === 0x90) {
    return data2 > 0;
  }
  if (high === 0x80) {
    return false;
  }
  return null;
}

function rememberHalf(
  state: ParserState,
  status: number,
  data1: number,
  value: number,
): ParserState {
  const key = halfKey(status, data1);
  if (state.halves[key] === value) {
    return state;
  }
  return { halves: { ...state.halves, [key]: value } };
}

function buildLookup(mapping: ControllerMapping): ReadonlyMap<string, LookupEntry> {
  const map = new Map<string, LookupEntry>();
  for (const binding of mapping.controls) {
    switch (binding.kind) {
      case "button":
      case "pad":
        addEdge(map, binding.status, binding.data1, binding);
        break;
      case "jog":
        addOnce(map, binding.status, binding.data1, { binding, role: "jog" });
        break;
      case "pitch14":
      case "absolute14":
        addOnce(map, binding.msb.status, binding.msb.data1, { binding, role: "msb" });
        addOnce(map, binding.lsb.status, binding.lsb.data1, { binding, role: "lsb" });
        break;
    }
  }
  return map;
}

/** Note bindings answer both note-on and note-off for the same channel and number. */
function addEdge(
  map: Map<string, LookupEntry>,
  status: number,
  data1: number,
  binding: ControlBinding,
): void {
  const channel = status & 0x0f;
  const high = status & 0xf0;
  if (high === 0x80 || high === 0x90) {
    addOnce(map, 0x80 | channel, data1, { binding, role: "edge" });
    addOnce(map, 0x90 | channel, data1, { binding, role: "edge" });
    return;
  }
  addOnce(map, status, data1, { binding, role: "edge" });
}

function addOnce(
  map: Map<string, LookupEntry>,
  status: number,
  data1: number,
  entry: LookupEntry,
): void {
  const key = halfKey(status, data1);
  if (!map.has(key)) {
    map.set(key, entry);
  }
}

function halfKey(status: number, data1: number): string {
  return `${status & 0xff}:${data1 & 0x7f}`;
}

function normalizePitch(value14: number): number {
  const normalized = (value14 - PITCH_14_CENTER) / PITCH_14_CENTER;
  if (normalized < -1) {
    return -1;
  }
  if (normalized > 1) {
    return 1;
  }
  return normalized;
}

function normalizeAbsolute(value14: number): number {
  const value = value14 / PITCH_14_MAX;
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function idle(state: ParserState): ParseResult {
  return { actions: [], state };
}
