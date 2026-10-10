// M11 (UI): deck effect panel (picker, STR / SPD) and headphone cue (CUE A / B, CUE/MASTER,
// Ctrl+Shift+1 / 2, a note when the sound card has no headphone channels).

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { backend } from "../ipc/backend";
import type { StatusSnapshot } from "../ipc/types";
import { status } from "../state/app";
import { renderApp, type Mock } from "../test/renderApp";
import { fxSpeedText } from "./deck/Deck";

async function syncStatus(change?: (s: StatusSnapshot) => StatusSnapshot): Promise<void> {
  const r = await backend().engineStatus();
  if (!r.ok) throw new Error(r.error);
  act(() => {
    status.set(change ? change(r.value) : r.value);
  });
}

function commands(mock: Mock): unknown[] {
  return mock.calls.filter(([c]) => c === "engineCommand").map(([, a]) => a);
}

describe("deck effects", () => {
  it("SPD reads in beats for the echo and seconds per sweep otherwise", () => {
    expect(fxSpeedText("echo", 0)).toBe("¼ beat");
    expect(fxSpeedText("echo", 0.75)).toBe("1 beat");
    expect(fxSpeedText("echo", 1)).toBe("2 beat");
    expect(fxSpeedText("flanger", 0)).toBe("8.0 s per sweep");
    expect(fxSpeedText("filter", 1)).toBe("0.25 s per sweep");
  });

  it("picking an effect and turning STR / SPD sends them to that deck", async () => {
    const { mock } = await renderApp();
    const panel = within(screen.getByRole("region", { name: "Deck B" })).getByRole("group", { name: "Deck B effect" });
    fireEvent.click(within(panel).getByRole("button", { name: /Flanger/ }));
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "fx", deck: "B", kind: "flanger" });
    });
    const str = within(panel).getByRole("slider", { name: "STR" });
    fireEvent.keyDown(str, { key: "ArrowUp" });
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "fxParams", deck: "B", strength: 0.55, speed: 0.5 });
    });
    expect(within(panel).getByRole("button", { name: /Flanger/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("headphone cue", () => {
  it("CUE buttons follow the engine and Ctrl+Shift+1 toggles deck A", async () => {
    const { mock } = await renderApp();
    await syncStatus();
    const cueA = screen.getByRole("button", { name: "Headphone cue deck A" });
    expect(cueA).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(cueA);
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "cue", deck: "A", on: true });
    });
    await syncStatus();
    expect(screen.getByRole("button", { name: "Headphone cue deck A" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "!", code: "Digit1", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "cue", deck: "A", on: false });
    });
    fireEvent.keyDown(window, { key: "@", code: "Digit2", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(commands(mock)).toContainEqual({ type: "cue", deck: "B", on: true });
    });
  });

  it("CUE/MASTER knob blends the headphones; a stereo card says it has no headphone out", async () => {
    const { mock } = await renderApp();
    const knob = screen.getByRole("slider", { name: "CUE/MST" });
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    await waitFor(() => {
      expect(commands(mock).some((c) => typeof c === "object" && c !== null && "type" in c && c.type === "cueMix")).toBe(true);
    });
    await syncStatus((s) => ({ ...s, output: { ...s.output, running: true }, outputChannels: 2 }));
    expect(screen.getByText("no headphone out on this card")).toBeInTheDocument();
    await syncStatus((s) => ({ ...s, output: { ...s.output, running: true }, outputChannels: 4 }));
    expect(screen.queryByText("no headphone out on this card")).toBeNull();
  });
});
