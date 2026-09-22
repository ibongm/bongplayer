/**
 * Web MIDI hot-plug support (Risk #5): requests MIDI access, listens for
 * `statechange` (devices plugged/unplugged at any time, not just at
 * startup), and wires each recognized input's `midimessage` events through
 * the pure parser (src/services/midi/parser.ts) into real store/engine
 * calls (src/services/midiDispatch.ts).
 */

import { createParserState, parseMidiMessage } from "./midi/parser";
import { DDJ400_PROFILE } from "./midi/ddj400Profile";
import type { ControllerMapping, ParserState } from "./midi/types";
import { applyDeckAction } from "./midiDispatch";
import { attachMidiOutput, detachMidiOutput, startMidiLedSync } from "./midiOutput";

const KNOWN_PROFILES: readonly ControllerMapping[] = [DDJ400_PROFILE];

interface ConnectedInput {
  readonly input: MIDIInput;
  readonly mapping: ControllerMapping;
  state: ParserState;
}

const connectedInputs = new Map<string, ConnectedInput>();

function matchProfile(input: MIDIInput): ControllerMapping | null {
  const name = (input.name ?? "").toLowerCase();
  for (const profile of KNOWN_PROFILES) {
    if (name.includes("ddj-400") || name.includes("ddj400")) {
      return profile;
    }
  }
  return null;
}

function handleMidiMessage(inputId: string, event: MIDIMessageEvent): void {
  const entry = connectedInputs.get(inputId);
  if (entry === undefined || event.data === null) return;
  const result = parseMidiMessage(event.data, entry.mapping, entry.state);
  entry.state = result.state;
  for (const action of result.actions) {
    applyDeckAction(action);
  }
}

function attachInput(input: MIDIInput): void {
  if (connectedInputs.has(input.id)) return;
  const mapping = matchProfile(input);
  if (mapping === null) return; // Unrecognized controller — no profile to decode it with.
  connectedInputs.set(input.id, { input, mapping, state: createParserState() });
  input.onmidimessage = (event) => handleMidiMessage(input.id, event);
}

function detachInput(inputId: string): void {
  const entry = connectedInputs.get(inputId);
  if (entry === undefined) return;
  entry.input.onmidimessage = null;
  connectedInputs.delete(inputId);
}

/**
 * Starts hot-plug MIDI support. Safe to call even when the Web MIDI API is
 * unavailable (older WebView2 runtimes) or access is denied/unsupported by
 * the runtime (observed: WebView2 currently rejects requestMIDIAccess()
 * with NotAllowedError outright) — logs a warning and no-ops in either
 * case, rather than throwing or leaving an unhandled rejection. Returns a
 * teardown function.
 */
export async function initMidiHotPlug(): Promise<() => void> {
  if (typeof navigator.requestMIDIAccess !== "function") {
    console.warn(
      "Web MIDI API is not available in this runtime — MIDI controllers will not be detected.",
    );
    return () => {};
  }

  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch (error) {
    console.warn("Web MIDI access was not granted — MIDI controllers will not be detected.", error);
    return () => {};
  }

  for (const input of access.inputs.values()) {
    attachInput(input);
  }
  for (const output of access.outputs.values()) {
    attachMidiOutput(output);
  }

  function handleStateChange(event: MIDIConnectionEvent): void {
    const port = event.port;
    if (port === null) return;
    if (port.type === "input") {
      const input = port as MIDIInput;
      if (input.state === "connected") {
        attachInput(input);
      } else {
        detachInput(input.id);
      }
    } else {
      const output = port as MIDIOutput;
      if (output.state === "connected") {
        attachMidiOutput(output);
      } else {
        detachMidiOutput(output.id);
      }
    }
  }

  access.onstatechange = handleStateChange;
  const stopLedSync = startMidiLedSync();

  return () => {
    access.onstatechange = null;
    stopLedSync();
    for (const inputId of Array.from(connectedInputs.keys())) {
      detachInput(inputId);
    }
  };
}
