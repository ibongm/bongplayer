// M4 (UI side): hot cues, loops, pitch bend, CUE, TAP, overview seek, knobs reset on
// right-click, views, settings audio tab, never an endless "analyzing", keyboard shortcuts.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { backend } from "../../ipc/backend";
import type { DeckSnapshot, StatusSnapshot } from "../../ipc/types";
import { status } from "../../state/app";
import { mixer, view } from "../../state/ui";
import { renderApp, type Mock } from "../../test/renderApp";

/** Loads a track on deck A and copies the mock's engine status into the store. */
async function loadA(mock: Mock): Promise<void> {
  const lib = await mock.folderTracks("C:\\Users\\dj\\Music\\House");
  if (!lib.ok) throw new Error("no tracks");
  const first = lib.value.rows[0];
  if (!first) throw new Error("no tracks");
  await mock.deckLoad("A", first.id);
  await syncStatus();
}

async function syncStatus(): Promise<StatusSnapshot> {
  const r = await backend().engineStatus();
  if (!r.ok) throw new Error(r.error);
  act(() => {
    status.set(r.value);
  });
  return r.value;
}

function commands(mock: Mock): unknown[] {
  return mock.calls.filter(([c]) => c === "engineCommand").map(([, a]) => a);
}

function deckA(): HTMLElement {
  return screen.getByRole("region", { name: "Deck A" });
}

describe("deck controls", () => {
  it("hot cue pads: empty → set; set → jump; right-click → clear", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    const pads = within(deckA()).getByRole("group", { name: "Deck A hot cues" });
    fireEvent.click(within(pads).getByRole("button", { name: /Hot cue 3 \(empty\)/ }));
    await waitFor(async () => {
      const s = await syncStatus();
      expect(s.decks[0].cues[2]).not.toBeNull();
    });
    const set = await within(pads).findByRole("button", { name: /Hot cue 3 at/ });
    fireEvent.click(set);
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "jumpHotCue", deck: "A", slot: 2 });
    });
    fireEvent.contextMenu(set);
    await waitFor(async () => {
      const s = await syncStatus();
      expect(s.decks[0].cues[2]).toBeNull();
    });
  });

  it("loops: auto-loop 1–32 beats, IN / OUT, halve / double, exit", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    const loops = within(deckA()).getByRole("group", { name: "Deck A loops" });
    for (const n of [1, 2, 4, 8, 16, 32]) {
      expect(within(loops).getByRole("button", { name: new RegExp(`^Loop ${n} beats?`) })).toBeInTheDocument();
    }
    fireEvent.click(within(loops).getByRole("button", { name: /^Loop 4 beats/ }));
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "autoLoop", deck: "A", beats: 4 });
    });
    await syncStatus();
    fireEvent.click(within(loops).getByRole("button", { name: "Halve the loop" }));
    fireEvent.click(within(loops).getByRole("button", { name: "Double the loop" }));
    fireEvent.click(within(loops).getByRole("button", { name: "Exit the loop" }));
    fireEvent.click(within(loops).getByRole("button", { name: /Loop IN/ }));
    fireEvent.click(within(loops).getByRole("button", { name: /Loop OUT/ }));
    await waitFor(() => {
      const c = commands(mock);
      expect(c).toContainEqual({ type: "loopResize", deck: "A", factor: 0.5 });
      expect(c).toContainEqual({ type: "loopResize", deck: "A", factor: 2 });
      expect(c).toContainEqual({ type: "loopExit", deck: "A" });
      expect(c).toContainEqual({ type: "loopIn", deck: "A" });
      expect(c).toContainEqual({ type: "loopOut", deck: "A" });
    });
  });

  it("pitch bend while held, CUE press / release, CUP, SYNC", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    const up = within(deckA()).getByRole("button", { name: "Pitch bend up" });
    fireEvent.pointerDown(up);
    fireEvent.pointerUp(up);
    const cue = within(deckA()).getByRole("button", { name: "CUE" });
    fireEvent.pointerDown(cue);
    fireEvent.pointerUp(cue);
    fireEvent.click(within(deckA()).getByRole("button", { name: "CUP — jump to the cue point and play" }));
    await waitFor(() => {
      const c = commands(mock);
      expect(c).toContainEqual({ type: "bend", deck: "A", bend: 0.04 });
      expect(c).toContainEqual({ type: "bend", deck: "A", bend: 0 });
      expect(c).toContainEqual({ type: "cuePress", deck: "A" });
      expect(c).toContainEqual({ type: "cueRelease", deck: "A" });
      expect(c).toContainEqual({ type: "cuePlay", deck: "A" });
    });
  });

  it("TAP: four taps set the track's BPM", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    const setBpm = vi.spyOn(mock, "setBpm");
    const times = [1000, 1500, 2000, 2500];
    const now = vi.spyOn(performance, "now");
    const tap = within(deckA()).getByRole("button", { name: "Tap tempo" });
    for (const t of times) {
      now.mockReturnValue(t);
      fireEvent.click(tap);
    }
    now.mockRestore();
    await waitFor(() => {
      expect(setBpm).toHaveBeenCalledWith([expect.any(Number)], 120);
    });
  });

  it("clicking the overview jumps to that point", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    const s = status.get();
    const duration = s?.decks[0].duration ?? 0;
    const overview = within(deckA()).getByRole("slider", { name: /Deck A overview/ });
    overview.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 40, right: 500, bottom: 40, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(overview, { clientX: 300, clientY: 20 });
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "seek", deck: "A", seconds: duration / 2 });
    });
  });

  it("never shows an endless 'analyzing': progress, then a visible error", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    const base = status.get();
    if (!base) throw new Error("no status");
    const withDeck = (d: Partial<DeckSnapshot>): StatusSnapshot => ({
      ...base,
      decks: [{ ...base.decks[0], ...d }, base.decks[1]],
    });
    act(() => {
      status.set(withDeck({ decoded: 0.42, waveform: "computing" }));
    });
    expect(within(deckA()).getByText("Reading the file… 42 %")).toBeInTheDocument();
    act(() => {
      status.set(withDeck({ decoded: 0.42, waveform: "failed", decodeError: "decoding stopped responding (no progress for 15 s)" }));
    });
    expect(within(deckA()).getByRole("alert")).toHaveTextContent("decoding stopped responding");
  });
});

describe("mixer", () => {
  it("knobs: arrow keys adjust, right-click resets to default", async () => {
    const { mock } = await renderApp();
    const ch = screen.getByRole("group", { name: "Channel A" });
    const hi = within(ch).getByRole("slider", { name: "HI" });
    hi.focus();
    fireEvent.keyDown(hi, { key: "ArrowDown" });
    fireEvent.keyDown(hi, { key: "ArrowDown" });
    expect(mixer.get().A.high).toBeCloseTo(-1, 5);
    fireEvent.contextMenu(hi);
    expect(mixer.get().A.high).toBe(0);
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "eq", deck: "A", band: "high", db: 0 });
    });
    const kill = within(ch).getByRole("button", { name: "LOW kill deck A" });
    fireEvent.click(kill);
    expect(kill).toHaveAttribute("aria-pressed", "true");
    const xf = screen.getByRole("slider", { name: "CROSSFADER" });
    fireEvent.keyDown(xf, { key: "ArrowRight" });
    fireEvent.contextMenu(xf);
    await waitFor(() => {
      const c = commands(mock);
      expect(c).toContainEqual({ type: "kill", deck: "A", band: "low", on: true });
      expect(c).toContainEqual({ type: "crossfader", position: 0.5 });
    });
  });
});

describe("views, settings, shortcuts", () => {
  it("STANDARD / DECKS / LIBRARY views", async () => {
    await renderApp();
    expect(screen.getByRole("region", { name: "Mixer" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tracks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "DECKS" }));
    expect(screen.queryByRole("region", { name: "Tracks" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Mixer" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(view.get()).toBe("library");
    expect(screen.queryByRole("region", { name: "Mixer" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tracks" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(view.get()).toBe("standard");
  });

  it("settings: the Audio tab lists devices and saves the preferred one", async () => {
    const { mock } = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const ddj = await within(dialog).findByRole("radio", { name: /DDJ-400/ });
    fireEvent.click(ddj);
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["setPreferredOutput", "ddj-400"]);
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("keyboard: F1 plays deck A, 1 sets / jumps hot cue 1", async () => {
    const { mock } = await renderApp();
    await loadA(mock);
    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "togglePlay", deck: "A" });
    });
    fireEvent.keyDown(window, { key: "1", code: "Digit1" });
    await waitFor(async () => {
      const s = await syncStatus();
      expect(s.decks[0].cues[0]).not.toBeNull();
    });
    fireEvent.keyDown(window, { key: "1", code: "Digit1" });
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "jumpHotCue", deck: "A", slot: 0 });
    });
  });
});
