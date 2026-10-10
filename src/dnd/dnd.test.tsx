// M3 acceptance (A part): drag & drop, each of:
// - table row(s) → Deck A, Deck B, Automix queue, a crate in the explorer
// - Explorer file(s) → Deck A, Deck B, Automix queue
// - Explorer folder → folder tree (navigates) and Automix queue (enqueues contents)
// - reorder rows inside the Automix queue
// Internal drags use real pointer events; Explorer drops go through the same Tauri
// drag-drop event handler the desktop app uses. jsdom has no layout, so the element under
// the pointer is set explicitly with `pointAt`.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type DropListener = (e: { payload: unknown }) => void;
const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  listener: null as DropListener | null,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: (cb: DropListener) => {
      tauri.listener = cb;
      return Promise.resolve(() => undefined);
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { browser, queue, status } from "../state/app";
import { pointAt, renderApp } from "../test/renderApp";
import { lastDrop } from "./drag";
import { listenNativeDrops } from "./nativeDrop";

const MUSIC = "C:\\Users\\dj\\Music";

function rows(): HTMLElement[] {
  return within(screen.getByRole("grid")).getAllByRole("row");
}

async function openHouse(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Open Music" }));
  fireEvent.click(await screen.findByRole("treeitem", { name: /House/ }));
  await waitFor(() => {
    expect(screen.getByTestId("track-count")).toHaveTextContent("40 tracks");
  });
}

/** Drags `from` with the mouse and releases over `to`. */
async function pointerDrag(from: Element, to: Element | null, mods: { ctrlKey?: boolean } = {}): Promise<void> {
  fireEvent.pointerDown(from, { button: 0, clientX: 10, clientY: 10, ...mods });
  pointAt(to);
  fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
  fireEvent.pointerMove(window, { clientX: 300, clientY: 200 });
  fireEvent.pointerUp(window, { clientX: 300, clientY: 200 });
  await act(async () => {
    await lastDrop;
  });
}

function deck(name: "A" | "B"): HTMLElement {
  return screen.getByLabelText(`Deck ${name}`);
}

async function deckTitle(name: "A" | "B"): Promise<string> {
  const mock = await import("../ipc/backend");
  const r = await mock.backend().engineStatus();
  if (r.ok) status.set(r.value);
  return r.ok ? r.value.decks[name === "A" ? 0 : 1].title : "";
}

describe("drag & drop from the track table", () => {
  it("row → Deck A and Deck B", async () => {
    const { mock } = await renderApp();
    await openHouse();
    const [r0, r1] = rows();
    if (!r0 || !r1) throw new Error("rows");
    await pointerDrag(r0, deck("A"));
    expect(await deckTitle("A")).toBe("House Track 01");
    await pointerDrag(r1, deck("B"));
    expect(await deckTitle("B")).toBe("House Track 02");
    expect(mock.calls.filter(([c]) => c === "deckLoad")).toHaveLength(2);
  });

  it("several rows → Automix queue, in table order", async () => {
    await renderApp();
    await openHouse();
    const r = rows();
    const [r1, r3, r4] = [r[1], r[3], r[4]];
    if (!r1 || !r3 || !r4) throw new Error("rows");
    fireEvent.click(r1);
    fireEvent.click(r3, { ctrlKey: true });
    fireEvent.click(r4, { ctrlKey: true });
    await pointerDrag(r3, screen.getByRole("list", { name: "Automix queue" }));
    expect(queue.get().map((e) => e.track.title)).toEqual([
      "House Track 02",
      "House Track 04",
      "House Track 05",
    ]);
    expect(screen.getByTestId("queue-summary")).toHaveTextContent("3 tracks");
  });

  it("rows → a crate in the explorer", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "+ Crate" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Peak time" } });
    fireEvent.submit(dialog);
    const crate = await screen.findByRole("button", { name: /Peak time/ });
    await openHouse();
    const [r0, r1] = rows();
    if (!r0 || !r1) throw new Error("rows");
    fireEvent.click(r0);
    fireEvent.click(r1, { shiftKey: true });
    await pointerDrag(r0, crate);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Peak time/ })).toHaveTextContent("2");
    });
  });

  it("a click without moving does not start a drag", async () => {
    const { mock } = await renderApp();
    await openHouse();
    const [r0] = rows();
    if (!r0) throw new Error("rows");
    fireEvent.pointerDown(r0, { button: 0, clientX: 10, clientY: 10 });
    pointAt(deck("A"));
    fireEvent.pointerMove(window, { clientX: 12, clientY: 11 });
    fireEvent.pointerUp(window, { clientX: 12, clientY: 11 });
    expect(mock.calls.some(([c]) => c === "deckLoad")).toBe(false);
  });

  it("Esc cancels a drag", async () => {
    const { mock } = await renderApp();
    await openHouse();
    const [r0] = rows();
    if (!r0) throw new Error("rows");
    fireEvent.pointerDown(r0, { button: 0, clientX: 10, clientY: 10 });
    pointAt(deck("A"));
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
    expect(screen.getByTestId("drag-ghost")).toBeInTheDocument();
    expect(deck("A")).toHaveAttribute("data-drop-active", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 60 });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    expect(mock.calls.some(([c]) => c === "deckLoad")).toBe(false);
  });
});

describe("drag & drop from Windows Explorer (native drop event)", () => {
  async function nativeDrop(paths: string[], target: Element | null): Promise<void> {
    tauri.isTauri.mockReturnValue(true);
    await listenNativeDrops();
    tauri.isTauri.mockReturnValue(false);
    const listener = tauri.listener;
    if (!listener) throw new Error("native drop listener not installed");
    pointAt(target);
    act(() => {
      listener({ payload: { type: "enter", paths, position: { x: 100, y: 100 } } });
      listener({ payload: { type: "over", position: { x: 120, y: 110 } } });
    });
    if (target) expect(target).toHaveAttribute("data-drop-active", "true");
    await act(async () => {
      listener({ payload: { type: "drop", paths, position: { x: 120, y: 110 } } });
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("file → Deck A and Deck B", async () => {
    const { mock } = await renderApp();
    const file = `${MUSIC}\\Rock Classics\\03 - Nirvana - Rock Track 03.mp3`;
    await nativeDrop([file], deck("A"));
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["deckLoadPath", { deck: "A", path: file }]);
    });
    await nativeDrop(["C:\\Downloads\\New Song.flac"], deck("B"));
    await waitFor(async () => {
      expect(await deckTitle("B")).toBe("New Song");
    });
  });

  it("a non-audio file on a deck shows an error instead of failing silently", async () => {
    await renderApp();
    await nativeDrop(["C:\\Users\\dj\\notes.txt"], deck("A"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/drop an audio file/);
  });

  it("files → Automix queue", async () => {
    await renderApp();
    await nativeDrop(
      [`${MUSIC}\\House\\01 - a.mp3`, `${MUSIC}\\House\\02 - b.mp3`],
      screen.getByRole("list", { name: "Automix queue" }),
    );
    await waitFor(() => {
      expect(queue.get()).toHaveLength(2);
    });
  });

  it("folder → folder tree navigates to it", async () => {
    await renderApp();
    await nativeDrop([`${MUSIC}\\Hip Hop`], screen.getByRole("tree", { name: "Folders" }));
    await waitFor(() => {
      expect(browser.get().source).toEqual({ kind: "folder", path: `${MUSIC}\\Hip Hop` });
    });
    // Shown both under the "Music" shortcut and under C: › Users › dj › Music; both are marked.
    const items = screen.getAllByRole("treeitem", { name: /Hip Hop/ });
    expect(items.length).toBeGreaterThan(0);
    items.forEach((i) => {
      expect(i).toHaveAttribute("aria-selected", "true");
    });
    await waitFor(() => {
      expect(screen.getByTestId("track-count")).toHaveTextContent("40 tracks");
    });
  });

  it("folder → Automix queue enqueues its contents", async () => {
    await renderApp();
    await nativeDrop([`${MUSIC}\\Rock Classics`], screen.getByRole("list", { name: "Automix queue" }));
    await waitFor(() => {
      expect(queue.get()).toHaveLength(40);
    });
    expect(queue.get()[0]?.track.title).toBe("Rock Track 01");
  });

  it("leaving the window cancels the native drag", async () => {
    await renderApp();
    tauri.isTauri.mockReturnValue(true);
    await listenNativeDrops();
    tauri.isTauri.mockReturnValue(false);
    pointAt(deck("A"));
    act(() => {
      tauri.listener?.({ payload: { type: "enter", paths: ["C:\\a.mp3"], position: { x: 1, y: 1 } } });
    });
    expect(screen.getByTestId("drag-ghost")).toBeInTheDocument();
    act(() => {
      tauri.listener?.({ payload: { type: "leave" } });
    });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    expect(deck("A")).not.toHaveAttribute("data-drop-active");
  });
});

describe("Automix queue", () => {
  it("rows can be reordered by dragging", async () => {
    await renderApp();
    await openHouse();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "a", ctrlKey: true });
    const first = rows()[0];
    if (!first) throw new Error("rows");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Escape" });
    // Queue tracks 1-4 with Q.
    fireEvent.click(first);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "q" });
    await waitFor(() => {
      expect(queue.get()).toHaveLength(4);
    });
    const list = screen.getByRole("list", { name: "Automix queue" });
    const items = (): HTMLElement[] => within(list).getAllByRole("listitem");
    // Drag the last entry onto the first: it is inserted before it.
    const [i0, , , i3] = items();
    if (!i0 || !i3) throw new Error("items");
    await pointerDrag(i3, i0);
    expect(queue.get().map((e) => e.track.title)).toEqual([
      "House Track 04",
      "House Track 01",
      "House Track 02",
      "House Track 03",
    ]);
    // Drag the first entry to the empty area of the list: it goes to the end.
    const [j0] = items();
    if (!j0) throw new Error("items");
    await pointerDrag(j0, list);
    expect(queue.get().map((e) => e.track.title)).toEqual([
      "House Track 01",
      "House Track 02",
      "House Track 03",
      "House Track 04",
    ]);
  });
});
