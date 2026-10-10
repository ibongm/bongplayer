// M9 (UI): the Sampler strip — drop a file or a table track on a pad, play with a click or
// Alt+1…8, choke group and volume from the pad menu, stop all, errors shown; deck pads switch
// between hot cues and the sampler.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { backend } from "../ipc/backend";
import { performDrop } from "../dnd/drop";
import { notices, openSource, status } from "../state/app";
import { samplerOpen } from "../state/sampler";
import { renderApp } from "../test/renderApp";

async function syncStatus(): Promise<void> {
  const r = await backend().engineStatus();
  if (!r.ok) throw new Error(r.error);
  act(() => {
    status.set(r.value);
  });
}

function strip(): HTMLElement {
  return screen.getByRole("region", { name: "Sampler" });
}

function padTarget(n: number): Element {
  const el = strip().querySelector(`[data-drop="pad"][data-drop-value="${n}"]`);
  if (!el) throw new Error(`no pad ${n}`);
  return el;
}

async function openStrip(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "SAMPLER" }));
  await within(strip()).findByRole("button", { name: "Pad 1: empty" });
}

describe("Sampler strip", () => {
  it("opens from the top bar and Ctrl+P, with 8 empty pads", async () => {
    await renderApp();
    expect(screen.queryByRole("region", { name: "Sampler" })).toBeNull();
    await openStrip();
    expect(within(strip()).getAllByRole("button", { name: /^Pad \d: empty$/ })).toHaveLength(8);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(samplerOpen.get()).toBe(false);
  });

  it("a file dropped from Explorer loads the pad; click and Alt+n play it; Stop all", async () => {
    const { mock } = await renderApp();
    await openStrip();
    await act(async () => {
      await performDrop(
        { kind: "files", paths: ["C:\\Users\\dj\\Sounds\\Air Horn.wav"], label: "Air Horn.wav" },
        { type: "pad", value: "2", el: padTarget(2) },
      );
    });
    const pad = await within(strip()).findByRole("button", { name: "Pad 3: Air Horn" });
    fireEvent.click(pad);
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["samplerTrigger", 2]);
    });
    await syncStatus();
    expect(within(strip()).getByRole("button", { name: "Pad 3: Air Horn" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "3", code: "Digit3", altKey: true });
    await waitFor(() => {
      expect(mock.calls.filter(([c, a]) => c === "samplerTrigger" && a === 2)).toHaveLength(2);
    });

    fireEvent.click(within(strip()).getByRole("button", { name: "Stop all" }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["samplerStop", null]);
    });
  });

  it("a track dragged from the table loads the pad; a non-audio file is refused visibly", async () => {
    const { mock } = await renderApp();
    await openStrip();
    const lib = await mock.folderTracks("C:\\Users\\dj\\Music\\House");
    if (!lib.ok) throw new Error("no tracks");
    // Show the folder in the table so the drop can find the track's file.
    await act(async () => {
      await openSource({ kind: "folder", path: "C:\\Users\\dj\\Music\\House" });
    });
    const track = lib.value.rows[0];
    if (!track) throw new Error("no track");
    await act(async () => {
      await performDrop({ kind: "tracks", trackIds: [track.id], label: track.title }, { type: "pad", value: "0", el: padTarget(0) });
    });
    expect(mock.calls).toContainEqual(["samplerLoad", { pad: 0, path: track.path }]);

    await act(async () => {
      await performDrop(
        { kind: "files", paths: ["C:\\notes.txt"], label: "notes.txt" },
        { type: "pad", value: "1", el: padTarget(1) },
      );
    });
    expect(notices.get().some((n) => n.kind === "error" && n.text.includes("Pad 2: drop an audio file"))).toBe(true);
  });

  it("pad menu sets the choke group and volume, and clears the pad", async () => {
    const { mock } = await renderApp();
    await openStrip();
    await act(async () => {
      await performDrop(
        { kind: "files", paths: ["C:\\Sounds\\Drop.mp3"], label: "Drop.mp3" },
        { type: "pad", value: "0", el: padTarget(0) },
      );
    });
    const pad = await within(strip()).findByRole("button", { name: "Pad 1: Drop" });
    fireEvent.contextMenu(pad, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: /Choke group/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Group 2/ }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["samplerConfigure", { pad: 0, gainDb: 0, choke: 2 }]);
    });
    await within(strip()).findByText(/1 · G2/);

    fireEvent.contextMenu(within(strip()).getByRole("button", { name: "Pad 1: Drop" }), { clientX: 10, clientY: 10 });
    fireEvent.mouseEnter(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Volume/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /−6\.0 dB/ }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["samplerConfigure", { pad: 0, gainDb: -6, choke: 2 }]);
    });

    fireEvent.contextMenu(within(strip()).getByRole("button", { name: "Pad 1: Drop" }), { clientX: 10, clientY: 10 });
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Clear pad 1/ }));
    await within(strip()).findByRole("button", { name: "Pad 1: empty" });
  });

  it("deck pads switch between hot cues and the sampler", async () => {
    const { mock } = await renderApp();
    await act(async () => {
      await backend().samplerLoad(4, "C:\\Sounds\\Siren.wav");
    });
    const deck = screen.getByRole("region", { name: "Deck A" });
    expect(within(deck).getByRole("group", { name: "Deck A hot cues" })).toBeInTheDocument();
    fireEvent.click(within(deck).getByRole("tab", { name: "SAMPLER" }));
    const padsGroup = await within(deck).findByRole("group", { name: "Deck A sampler pads" });
    const siren = await within(padsGroup).findByRole("button", { name: "Sampler pad 5: Siren" });
    expect(within(padsGroup).getByRole("button", { name: "Sampler pad 1: empty" })).toBeDisabled();
    fireEvent.click(siren);
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["samplerTrigger", 4]);
    });
  });
});
