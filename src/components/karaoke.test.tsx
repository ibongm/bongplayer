// M8 acceptance (UI): KARAOKE tab above the master controls; current line highlighted as the
// deck plays; clicking a line seeks the active deck; the LRC button toggles the drawer.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { backend } from "../ipc/backend";
import type { DeckSnapshot, StatusSnapshot } from "../ipc/types";
import { status } from "../state/app";
import { activeDeck, currentLine, lyricsDrawer } from "../state/lyrics";
import { renderApp, type Mock } from "../test/renderApp";

/** Loads a track that has lyrics (even id in the stand-in library) on `deck`. */
async function loadWithLyrics(mock: Mock, deck: "A" | "B", withLyrics = true): Promise<number> {
  const lib = await mock.folderTracks("C:\\Users\\dj\\Music\\House");
  if (!lib.ok) throw new Error("no tracks");
  const row = lib.value.rows.find((r) => (r.id % 2 === 0) === withLyrics);
  if (!row) throw new Error("no track");
  await mock.deckLoad(deck, row.id);
  return row.id;
}

async function syncStatus(change?: (s: StatusSnapshot) => StatusSnapshot): Promise<void> {
  const r = await backend().engineStatus();
  if (!r.ok) throw new Error(r.error);
  act(() => {
    status.set(change ? change(r.value) : r.value);
  });
}

function withDeckA(s: StatusSnapshot, d: Partial<DeckSnapshot>): StatusSnapshot {
  return { ...s, decks: [{ ...s.decks[0], ...d }, s.decks[1]] };
}

function openKaraoke(): HTMLElement {
  const mixer = screen.getByRole("region", { name: "Mixer" });
  fireEvent.click(within(mixer).getByRole("tab", { name: "KARAOKE" }));
  return within(mixer).getByRole("tabpanel", { name: "Karaoke" });
}

describe("lyrics helpers", () => {
  it("finds the line being sung", () => {
    const lines = [0, 5000, 10_000, 15_000].map((ms) => ({ ms, text: String(ms) }));
    expect(currentLine([], 3)).toBe(-1);
    expect(currentLine(lines.slice(1), 1)).toBe(-1);
    expect(currentLine(lines, 0)).toBe(0);
    expect(currentLine(lines, 4.999)).toBe(0);
    expect(currentLine(lines, 5)).toBe(1);
    expect(currentLine(lines, 12)).toBe(2);
    expect(currentLine(lines, 999)).toBe(3);
  });

  it("follows the deck the audience hears", async () => {
    const { mock } = await renderApp();
    await loadWithLyrics(mock, "A");
    await loadWithLyrics(mock, "B", false);
    const r = await backend().engineStatus();
    if (!r.ok) throw new Error(r.error);
    const s = r.value;
    const play = (a: boolean, b: boolean, crossfader: number): StatusSnapshot => ({
      ...s,
      crossfader,
      decks: [
        { ...s.decks[0], playing: a },
        { ...s.decks[1], playing: b },
      ],
    });
    expect(activeDeck(null)).toBeNull();
    expect(activeDeck(play(false, false, 0.5))).toBe(0);
    expect(activeDeck(play(false, true, 0))).toBe(1);
    expect(activeDeck(play(true, false, 1))).toBe(0);
    expect(activeDeck(play(true, true, 0.2))).toBe(0);
    expect(activeDeck(play(true, true, 0.8))).toBe(1);
  });
});

describe("KARAOKE tab", () => {
  it("sits above the master controls", async () => {
    await renderApp();
    const mixer = screen.getByRole("region", { name: "Mixer" });
    const tab = within(mixer).getByRole("tab", { name: "KARAOKE" });
    const master = within(mixer).getByRole("group", { name: "Master transport" });
    // The tab comes first in the mixer, and stays there when KARAOKE is open.
    expect(tab.compareDocumentPosition(master) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    openKaraoke();
    expect(within(mixer).getByRole("group", { name: "Master transport" })).toBeInTheDocument();
    expect(within(mixer).getByRole("tab", { name: "KARAOKE" })).toHaveAttribute("aria-selected", "true");
  });

  it("highlights the current line as the deck plays and seeks on click", async () => {
    const { mock } = await renderApp();
    await loadWithLyrics(mock, "A");
    await syncStatus((s) => withDeckA(s, { position: 0, playing: false }));
    const panel = openKaraoke();
    const list = await within(panel).findByRole("list", { name: "Lyrics lines" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(panel).toHaveTextContent("Deck A · from .lrc file");

    // 11 s in: the third line (10 s) is current.
    await syncStatus((s) => withDeckA(s, { position: 11, playing: false }));
    await waitFor(() => {
      expect(list.querySelector('[aria-current="true"]')).toHaveTextContent("Second line");
    });
    await syncStatus((s) => withDeckA(s, { position: 21, playing: false }));
    await waitFor(() => {
      expect(list.querySelector('[aria-current="true"]')).toHaveTextContent("Fourth line");
    });
    expect(list.querySelectorAll('[aria-current="true"]')).toHaveLength(1);

    // Clicking a line jumps the deck there.
    fireEvent.click(within(list).getByRole("button", { name: "Third line" }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual(["engineCommand", { type: "seek", deck: "A", seconds: 15 }]);
    });
  });

  it("says so when a track has no lyrics (never an endless spinner)", async () => {
    const { mock } = await renderApp();
    await loadWithLyrics(mock, "A", false);
    await syncStatus();
    const panel = openKaraoke();
    await within(panel).findByText(/No lyrics found/);
  });
});

describe("LRC button", () => {
  it("toggles the lyrics drawer (also Ctrl+Y)", async () => {
    const { mock } = await renderApp();
    await loadWithLyrics(mock, "A");
    await syncStatus();
    expect(screen.queryByRole("dialog", { name: "Lyrics" })).toBeNull();
    const button = screen.getByRole("button", { name: "LRC" });
    fireEvent.click(button);
    const drawer = screen.getByRole("dialog", { name: "Lyrics" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await within(drawer).findByRole("button", { name: "Last line" });
    fireEvent.click(button);
    expect(screen.queryByRole("dialog", { name: "Lyrics" })).toBeNull();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(lyricsDrawer.get()).toBe(true);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(lyricsDrawer.get()).toBe(false);
  });
});
