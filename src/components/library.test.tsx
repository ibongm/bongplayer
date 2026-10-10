// M3 acceptance (UI): folder tree, virtualised table, multi-select, context menu with
// submenus, actions on the whole selection, stable row count, crates.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { browser } from "../state/app";
import { renderApp, type Mock } from "../test/renderApp";


function grid(): HTMLElement {
  return screen.getByRole("grid");
}

function rows(): HTMLElement[] {
  return within(grid()).getAllByRole("row");
}

async function openFolder(name: string): Promise<void> {
  const music = screen.getByRole("treeitem", { name: /^▸?\s*Music/ });
  // Expand "Music" lazily, then click the subfolder.
  fireEvent.click(within(music).getByRole("button", { name: "Open Music" }));
  const item = await screen.findByRole("treeitem", { name: new RegExp(name) });
  fireEvent.click(item);
  await waitFor(() => {
    expect(screen.getByTestId("track-count")).not.toHaveTextContent(/^0 tracks/);
  });
}

describe("explorer", () => {
  it("lists drives (including USB) and opens folders one level at a time", async () => {
    const { mock } = await renderApp();
    const listDir = vi.spyOn(mock, "listDir");
    expect(screen.getByRole("treeitem", { name: /^▸?\s*C:/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /^▸?\s*E:/ })).toBeInTheDocument();
    // Nothing listed until a folder is opened.
    expect(listDir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open Music" }));
    await screen.findByRole("treeitem", { name: /House/ });
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(listDir).toHaveBeenCalledWith("C:\\Users\\dj\\Music");
  });

  it("keyboard: arrows move, → opens a folder, Enter shows its tracks", async () => {
    await renderApp();
    const first = screen.getAllByRole("treeitem")[0];
    if (!first) throw new Error("no tree");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    await screen.findByRole("treeitem", { name: /House/ });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAttribute("data-tree-index", "1");
    fireEvent.keyDown(document.activeElement ?? first, { key: "Enter" });
    await waitFor(() => {
      expect(browser.get().source).toEqual({ kind: "folder", path: "C:\\Users\\dj\\Music\\Hip Hop" });
    });
  });
});

describe("track table", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("is virtualised: a 50,000-track folder renders only the visible rows", async () => {
    await renderApp({ bigFolderTracks: 50_000 });
    const started = performance.now();
    await openFolder("Big Archive");
    const took = performance.now() - started;
    expect(screen.getByTestId("track-count")).toHaveTextContent("50000 tracks");
    expect(rows().length).toBeLessThan(80);
    expect(grid()).toHaveAttribute("aria-rowcount", "50000");
    // Opening includes the mock's work; the real target (< 1 s) is measured in Rust.
    expect(took).toBeLessThan(5000);
  });

  it("multi-select: click, Ctrl+click, Shift+click, Ctrl+A, Esc — count shown", async () => {
    await renderApp();
    await openFolder("House");
    const r = rows();
    const [r0, r2, r5] = [r[0], r[2], r[5]];
    if (!r0 || !r2 || !r5) throw new Error("rows missing");
    fireEvent.click(r0);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    fireEvent.click(r2, { ctrlKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
    fireEvent.click(r5, { shiftKey: true });
    // Range from the anchor (row 2) to row 5 replaces the selection.
    expect(screen.getByTestId("selection-count")).toHaveTextContent("4 selected");
    fireEvent.click(r0, { ctrlKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("5 selected");
    fireEvent.keyDown(grid(), { key: "a", ctrlKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("40 selected");
    fireEvent.keyDown(grid(), { key: "Escape" });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("");
    // Keyboard selection.
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    expect(screen.getByTestId("selection-count")).toHaveTextContent("3 selected");
  });

  it("search filters the list and clears", async () => {
    await renderApp();
    await openFolder("House");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tracks" }), {
      target: { value: "Track 07" },
    });
    expect(screen.getByTestId("track-count")).toHaveTextContent("1 track");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByTestId("track-count")).toHaveTextContent("40 tracks");
  });
});

async function openRowMenu(rowIndex: number, mods: { ctrlKey?: boolean } = {}): Promise<HTMLElement> {
  const row = rows()[rowIndex];
  if (!row) throw new Error("row missing");
  fireEvent.contextMenu(row, { clientX: 100, clientY: 100, ...mods });
  return await screen.findByRole("menu", { name: "Context menu" });
}

function selectRows(indices: number[]): void {
  indices.forEach((i, n) => {
    const row = rows()[i];
    if (!row) throw new Error("row missing");
    fireEvent.click(row, { ctrlKey: n > 0 });
  });
}

describe("context menu", () => {
  it("lists actions for the whole selection with counts; Load names the focused track", async () => {
    await renderApp();
    await openFolder("House");
    selectRows([0, 1, 2]);
    const menu = await openRowMenu(2);
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Load “House Track 03” to Deck A/),
        expect.stringMatching(/Load “House Track 03” to Deck B/),
        expect.stringMatching(/Add 3 tracks to Automix/),
        expect.stringMatching(/Add 3 tracks to crate/),
        expect.stringMatching(/Batch Operations/),
        expect.stringMatching(/File Operations/),
        expect.stringMatching(/Mark 3 tracks as played/),
      ]),
    );
  });

  it("submenus open on hover and close when another item is hovered", async () => {
    await renderApp();
    await openFolder("House");
    selectRows([0]);
    const menu = await openRowMenu(0);
    const batch = within(menu).getByRole("menuitem", { name: /Batch Operations/ });
    fireEvent.mouseEnter(batch);
    const sub = await screen.findByRole("menu", { name: "Submenu" });
    expect(within(sub).getByRole("menuitem", { name: /Analyze BPM & key \(1 track\)/ })).toBeInTheDocument();
    expect(batch).toHaveAttribute("aria-expanded", "true");
    // Leaving: hover a plain item → the submenu closes.
    vi.useFakeTimers();
    fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: /Load to Deck A/ }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    vi.useRealTimers();
    expect(screen.queryByRole("menu", { name: "Submenu" })).not.toBeInTheDocument();
  });

  it("keyboard: → opens a submenu, ← closes it, Esc closes the menu", async () => {
    await renderApp();
    await openFolder("House");
    selectRows([0]);
    const menu = await openRowMenu(0);
    // Move down to "File Operations".
    const target = within(menu).getByRole("menuitem", { name: /File Operations/ });
    let guard = 0;
    while (document.activeElement !== target && guard++ < 20) {
      fireEvent.keyDown(document.activeElement ?? menu, { key: "ArrowDown" });
    }
    expect(document.activeElement).toBe(target);
    fireEvent.keyDown(target, { key: "ArrowRight" });
    const sub = await screen.findByRole("menu", { name: "Submenu" });
    await waitFor(() => {
      expect(sub.contains(document.activeElement)).toBe(true);
    });
    fireEvent.keyDown(document.activeElement ?? sub, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Submenu" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(target);
    fireEvent.keyDown(target, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("actions apply to every selected track", async () => {
    const { mock } = await renderApp();
    await openFolder("House");
    selectRows([0, 3, 4]);
    let menu = await openRowMenu(4);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Mark 3 tracks as played/ }));
    await waitFor(() => {
      expect(mock.calls.some(([c]) => c === "markPlayed")).toBe(true);
    });
    const played = mock.calls.find(([c]) => c === "markPlayed")?.[1];
    expect(played).toHaveLength(3);

    menu = await openRowMenu(4);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Add 3 tracks to Automix/ }));
    await waitFor(() => {
      expect(screen.getByTestId("queue-summary")).toHaveTextContent("3 tracks");
    });

    menu = await openRowMenu(4);
    fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: /Batch Operations/ }));
    const sub = await screen.findByRole("menu", { name: "Submenu" });
    fireEvent.click(within(sub).getByRole("menuitem", { name: /Analyze BPM & key \(3 tracks\)/ }));
    await waitFor(() => {
      expect(mock.calls.find(([c]) => c === "analyzeTracks")?.[1]).toHaveLength(3);
    });
  });

  it("the row count never drops to 0 after a menu action", async () => {
    await renderApp();
    await openFolder("House");
    const counts: number[] = [];
    const unsub = browser.subscribe(() => counts.push(browser.get().rows.length));
    selectRows([0, 1]);
    const menu = await openRowMenu(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Mark 2 tracks as played/ }));
    await waitFor(() => {
      expect(browser.get().loading).toBe(false);
      expect(counts.length).toBeGreaterThan(2);
    });
    unsub();
    expect(counts.every((n) => n === 40)).toBe(true);
    expect(screen.getByTestId("track-count")).toHaveTextContent("40 tracks");
  });
});

describe("crates & playlists", () => {
  async function answerPrompt(value: string): Promise<void> {
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).queryByRole("textbox");
    if (input) fireEvent.change(input, { target: { value } });
    fireEvent.submit(dialog);
  }

  it("create, rename and delete", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "+ Crate" }));
    await answerPrompt("Friday");
    const item = await screen.findByRole("button", { name: /Friday/ });
    fireEvent.keyDown(item, { key: "F2" });
    await answerPrompt("Saturday");
    const renamed = await screen.findByRole("button", { name: /Saturday/ });
    fireEvent.keyDown(renamed, { key: "Delete" });
    await answerPrompt("");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Saturday/ })).not.toBeInTheDocument();
    });
    expect(screen.getByText("No crates yet.")).toBeInTheDocument();
  });

  it("a crate created from the menu receives the selected tracks", async () => {
    await renderApp();
    await openFolder("House");
    selectRows([0, 1]);
    const menu = await openRowMenu(1);
    fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: /Add 2 tracks to crate/ }));
    const sub = await screen.findByRole("menu", { name: "Submenu" });
    fireEvent.click(within(sub).getByRole("menuitem", { name: "New crate…" }));
    await answerPrompt("Warm-up");
    const crate = await screen.findByRole("button", { name: /Warm-up/ });
    await waitFor(() => {
      expect(crate).toHaveTextContent("2");
    });
    fireEvent.click(crate);
    await waitFor(() => {
      expect(screen.getByTestId("track-count")).toHaveTextContent("2 tracks");
    });
  });
});

export type { Mock };
