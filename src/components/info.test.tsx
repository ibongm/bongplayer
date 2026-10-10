// M7 acceptance (UI): Info panel shows the track's details; internet lookup is OFF by default
// and only runs after it is switched on in Settings → Internet; covers show in the table.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(() => Promise.resolve(false)),
}));

import { browser, openSource } from "../state/app";
import { renderApp } from "../test/renderApp";

async function openLibraryAndSelect(index: number): Promise<HTMLElement> {
  await act(async () => {
    await openSource({ kind: "library" });
  });
  const grid = screen.getByRole("grid");
  await waitFor(() => {
    expect(within(grid).getAllByRole("row").length).toBeGreaterThan(index);
  });
  const row = within(grid).getAllByRole("row")[index];
  if (!row) throw new Error("no row");
  fireEvent.click(row);
  return row;
}

function openInfoTab(): HTMLElement {
  fireEvent.click(screen.getByRole("tab", { name: "Info" }));
  return screen.getByRole("region", { name: "Track info" });
}

describe("Info panel", () => {
  it("shows album, year, genre, rating, first seen, last played and play count", async () => {
    const { mock } = await renderApp();
    // Import some files so the library has tracks.
    const folder = mock.folders[0];
    if (!folder) throw new Error("no folder");
    await mock.folderTracks(folder);
    await openLibraryAndSelect(0);
    const info = openInfoTab();
    const track = browser.get().rows[0]?.track;
    if (!track) throw new Error("no track");
    expect(within(info).getByRole("heading", { name: track.title })).toBeInTheDocument();
    for (const label of ["album", "year", "genre", "play-count", "last-played", "first-seen", "bpm", "key", "length", "file"]) {
      expect(screen.getByTestId(`info-${label}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("info-play-count")).toHaveTextContent("0");
    expect(screen.getByTestId("info-last-played")).toHaveTextContent("never");

    // Rating: click 4 stars → saved for this track; click again → cleared.
    fireEvent.click(within(info).getByRole("radio", { name: "4 stars" }));
    await waitFor(() => {
      expect(browser.get().rows.find((r) => r.track.id === track.id)?.track.rating).toBe(4);
    });
    fireEvent.click(within(screen.getByRole("region", { name: "Track info" })).getByRole("radio", { name: "4 stars" }));
    await waitFor(() => {
      expect(browser.get().rows.find((r) => r.track.id === track.id)?.track.rating).toBe(0);
    });
  });

  it("Ctrl+I switches between Automix and Info", async () => {
    await renderApp();
    expect(screen.getByRole("tab", { name: "Automix" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(screen.getByRole("tab", { name: "Info" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Track info" })).toHaveTextContent("Select a track");
    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(screen.getByRole("tab", { name: "Automix" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Internet lookup", () => {
  it("is OFF by default: no lookup button, nothing sent", async () => {
    const { mock } = await renderApp();
    const folder = mock.folders[0];
    if (!folder) throw new Error("no folder");
    await mock.folderTracks(folder);
    await openLibraryAndSelect(0);
    const info = openInfoTab();
    await within(info).findByText(/Internet lookup is off/);
    expect(within(info).queryByRole("button", { name: "Look up online" })).toBeNull();
    expect(mock.calls.some(([c]) => c === "lookupTrack")).toBe(false);
    // The backend refuses too, even if asked directly.
    const id = browser.get().rows[0]?.track.id ?? 0;
    const r = await mock.lookupTrack(id);
    expect(r.ok).toBe(false);
  });

  it("after switching it on in Settings → Internet, a lookup fills empty fields", async () => {
    const { mock } = await renderApp();
    const folder = mock.folders[0];
    if (!folder) throw new Error("no folder");
    await mock.folderTracks(folder);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Internet" }));
    const box = await within(dialog).findByRole("checkbox", { name: /Look up missing covers/ });
    await waitFor(() => {
      expect(box).not.toBeDisabled();
    });
    expect(box).not.toBeChecked();
    expect(dialog).toHaveTextContent(/artist and title/);
    fireEvent.click(box);
    await waitFor(() => {
      expect(box).toBeChecked();
    });
    expect((await mock.settingGet("internet.lookup")).ok).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));

    await openLibraryAndSelect(0);
    const info = openInfoTab();
    const button = await within(info).findByRole("button", { name: "Look up online" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByTestId("info-album")).toHaveTextContent("Looked-up Album");
    });
    expect(mock.calls.filter(([c]) => c === "lookupTrack")).toHaveLength(1);
  });
});

describe("covers", () => {
  it("the table shows a cover thumbnail for tracks that have one", async () => {
    const { mock } = await renderApp();
    const folder = mock.folders[0];
    if (!folder) throw new Error("no folder");
    await mock.folderTracks(folder);
    const cover = vi.spyOn(mock, "trackCover");
    await act(async () => {
      await openSource({ kind: "library" });
    });
    const withCover = browser.get().rows.filter((r) => r.track.hasCover).length;
    expect(withCover).toBeGreaterThan(0);
    await waitFor(() => {
      expect(cover).toHaveBeenCalled();
    });
    // Only tracks that have a cover ask for one, and only small thumbnails in the table.
    for (const [id, large] of cover.mock.calls) {
      expect(browser.get().rows.find((r) => r.track.id === id)?.track.hasCover).toBe(true);
      expect(large).toBe(false);
    }
  });
});
