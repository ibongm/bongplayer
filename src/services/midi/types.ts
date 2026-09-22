/**
 * Controller-neutral deck commands. `type` is closed so a switch in the
 * transport layer is exhaustive.
 */

export type DeckId = "a" | "b";

export type EqBand = "high" | "mid" | "low";

export type JogMode = "scratch" | "bend" | "search";

export type PadIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type JogEncoding = "wrapped" | "center64";

export type ButtonAction = "play" | "pause" | "cue";

export type DeckAction =
  | { readonly type: "play"; readonly deck: DeckId; readonly down: boolean }
  | { readonly type: "pause"; readonly deck: DeckId; readonly down: boolean }
  | { readonly type: "cue"; readonly deck: DeckId; readonly down: boolean }
  | {
      readonly type: "pitch";
      readonly deck: DeckId;
      readonly value14: number;
      readonly normalized: number;
    }
  | { readonly type: "jog"; readonly deck: DeckId; readonly delta: number; readonly mode: JogMode }
  | { readonly type: "eq"; readonly deck: DeckId; readonly band: EqBand; readonly value: number }
  | { readonly type: "filter"; readonly deck: DeckId; readonly value: number }
  | { readonly type: "crossfade"; readonly value: number }
  | { readonly type: "volume"; readonly deck: DeckId; readonly value: number }
  | {
      readonly type: "hotcue";
      readonly deck: DeckId;
      readonly index: PadIndex;
      readonly down: boolean;
      readonly shifted: boolean;
    }
  | {
      readonly type: "sampler";
      readonly deck: DeckId;
      readonly slot: PadIndex;
      readonly down: boolean;
      readonly shifted: boolean;
    };

/** One decoded 3-byte channel message. Data bytes are 0..127. */
export interface MidiMessage {
  readonly status: number;
  readonly data1: number;
  readonly data2: number;
}

/** Status + controller/note number of one MIDI address. */
export interface MidiControlAddress {
  readonly status: number;
  readonly data1: number;
}

export interface ButtonBinding {
  readonly kind: "button";
  readonly status: number;
  readonly data1: number;
  readonly deck: DeckId;
  readonly action: ButtonAction;
}

export interface PadBinding {
  readonly kind: "pad";
  readonly status: number;
  readonly data1: number;
  readonly deck: DeckId;
  readonly pad: PadIndex;
  readonly shifted: boolean;
  readonly action: "hotcue" | "sampler";
}

export interface PitchBinding {
  readonly kind: "pitch14";
  readonly deck: DeckId;
  readonly msb: MidiControlAddress;
  readonly lsb: MidiControlAddress;
}

export interface AbsoluteBinding {
  readonly kind: "absolute14";
  readonly control: "eq" | "filter" | "crossfade" | "volume";
  /** Null only for the crossfader, which is not owned by a deck. */
  readonly deck: DeckId | null;
  /** Set for EQ. Null for filter, volume, and crossfader. */
  readonly band: EqBand | null;
  readonly msb: MidiControlAddress;
  readonly lsb: MidiControlAddress;
}

export interface JogBinding {
  readonly kind: "jog";
  readonly status: number;
  readonly data1: number;
  readonly deck: DeckId;
  readonly mode: JogMode;
  readonly encoding: JogEncoding;
}

export type ControlBinding =
  ButtonBinding | PadBinding | PitchBinding | AbsoluteBinding | JogBinding;

export interface ControllerMapping {
  readonly id: string;
  readonly name: string;
  readonly controls: readonly ControlBinding[];
}

/**
 * Last-seen 7-bit half of each 14-bit pair, keyed `${status}:${data1}`.
 * Passed back into the parser so MSB and LSB can arrive on separate messages.
 */
export interface ParserState {
  readonly halves: Readonly<Record<string, number>>;
}

export interface ParseResult {
  readonly actions: readonly DeckAction[];
  readonly state: ParserState;
}
