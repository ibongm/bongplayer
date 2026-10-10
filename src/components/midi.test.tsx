// M11 (UI): the DDJ-400 seen from the screen — knob moves follow, browse / LOAD use the track
// table, refusals become notices; Settings → MIDI shows the connection and switches it off.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { browser, notices, openSource } from "../state/app";
import { handleMidiEvent } from "../state/midi";
import { mixer } from "../state/ui";
import { renderApp } from "../test/renderApp";

describe("controller events", () => {
  it("knobs moved on the DDJ-400 move on screen (without sending them back)", async () => {
    const { mock } = await renderApp();
    const sent = mock.calls.length;
    act(() => {
      handleMidiEvent({ type: "mixer", deck: "B", key: "low", value: -24 });
      handleMidiEvent({ type: "mixer", deck: "A", key: "fader", value: 0.25 });
      handleMidiEvent({ type: "mixer", deck: null, key: "crossfader", value: 1 });
      handleMidiEvent({ type: "mixer", deck: "A", key: "bogus", value: 3 });
      handleMidiEvent("not an event");
    });
    expect(mixer.get().B.low).toBe(-24);
    expect(mixer.get().A.fader).toBe(0.25);
    expect(mixer.get().crossfader).toBe(1);
    expect(screen.getByRole("slider", { name: "CROSSFADER" })).toHaveAttribute("aria-valuenow", "1");
    expect(mock.calls.slice(sent).filter(([c]) => c === "engineCommand")).toHaveLength(0);
  });

  it("browse moves through the list and LOAD loads the selected track", async () => {
    const { mock } = await renderApp();
    await act(async () => {
      await openSource({ kind: "folder", path: "C:\\Users\\dj\\Music\\House" });
    });
    act(() => {
      handleMidiEvent({ type: "load", deck: "A" });
    });
    expect(notices.get().some((n) => n.text.includes("select a track"))).toBe(true);
    act(() => {
      handleMidiEvent({ type: "browse", steps: 1 });
      handleMidiEvent({ type: "browse", steps: 2 });
    });
    const focus = browser.get().selection.focus;
    expect(focus).toBe(2);
    const row = browser.get().rows[2];
    if (!row) throw new Error("no row");
    expect(screen.getByRole("grid").querySelector('[aria-selected="true"]')).toHaveAttribute("data-row-key", row.key);
    await act(async () => {
      handleMidiEvent({ type: "load", deck: "B" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["deckLoad", { deck: "B", trackId: row.track.id }]);
    });
  });

  it("refusals from the controller are shown", async () => {
    await renderApp();
    act(() => {
      handleMidiEvent({ type: "notice", text: "DDJ-400: Locked — unlock with the PIN or by holding LOCK" });
    });
    expect(await screen.findByText(/DDJ-400: Locked/)).toBeInTheDocument();
  });
});

describe("Settings → MIDI", () => {
  it("says when no DDJ-400 is plugged in", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "MIDI" }));
    expect(await within(dialog).findByTestId("midi-state")).toHaveTextContent("No DDJ-400 found");
    expect(within(dialog).getByRole("table", { name: "DDJ-400 controls" })).toHaveTextContent("Jog wheel");
  });

  it("shows the connected controller and switches it off", async () => {
    const { mock } = await renderApp({ midiDevice: "DDJ-400" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "MIDI" }));
    expect(await within(dialog).findByTestId("midi-state")).toHaveTextContent("Connected: DDJ-400");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Use the DDJ-400/ }));
    await waitFor(() => {
      expect(within(dialog).getByTestId("midi-state")).toHaveTextContent("Switched off.");
    });
    expect(mock.calls).toContainEqual(["midiEnable", false]);
  });
});
