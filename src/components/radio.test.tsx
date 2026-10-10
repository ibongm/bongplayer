// M6 (UI): Radio strip — presets, test (incl. the web-page message), load to deck, save,
// add to Automix; live deck display.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn() }));

import { backend } from "../ipc/backend";
import { queue, status } from "../state/app";
import { renderApp } from "../test/renderApp";
import { radioOpen } from "./RadioStrip";

async function sync(): Promise<void> {
  const r = await backend().engineStatus();
  if (r.ok) {
    act(() => {
      status.set(r.value);
    });
  }
}

async function openStrip(): Promise<HTMLElement> {
  act(() => {
    radioOpen.set(false);
  });
  fireEvent.click(screen.getByRole("button", { name: "RADIO" }));
  const strip = await screen.findByRole("region", { name: "Radio" });
  await within(strip).findByRole("option", { name: "Radio Dalmacija" });
  return strip;
}

describe("Radio strip", () => {
  it("presets, test, the web-page message, load to deck A as a live station", async () => {
    const { mock } = await renderApp();
    const strip = await openStrip();
    const select = within(strip).getByRole("combobox", { name: "Stations and presets" });
    const dalmacija = within(strip).getByRole("option", { name: "Radio Dalmacija" });
    fireEvent.change(select, { target: { value: dalmacija.getAttribute("value") } });
    expect(within(strip).getByRole("textbox", { name: "Station name" })).toHaveValue("Radio Dalmacija");
    expect(within(strip).getByRole("textbox", { name: "Stream address" })).toHaveValue(
      "http://shoutcast.pondi.hr:8000/listen.pls",
    );

    fireEvent.click(within(strip).getByRole("button", { name: "Test" }));
    expect(await within(strip).findByRole("status")).toHaveTextContent(/Works:/);

    // An address that is a web page is explained, not just "failed".
    fireEvent.change(within(strip).getByRole("textbox", { name: "Stream address" }), {
      target: { value: "https://streaming.bravo.hr/player/player.html?stream=0" },
    });
    fireEvent.click(within(strip).getByRole("button", { name: "Test" }));
    expect(await within(strip).findByRole("alert")).toHaveTextContent("this is a web page, not a stream");

    fireEvent.change(within(strip).getByRole("textbox", { name: "Stream address" }), {
      target: { value: "http://shoutcast.pondi.hr:8000/listen.pls" },
    });
    fireEvent.click(within(strip).getByRole("button", { name: "→ A" }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual([
        "deckLoadUrl",
        { deck: "A", url: "http://shoutcast.pondi.hr:8000/listen.pls", name: "Radio Dalmacija" },
      ]);
    });
    await sync();
    const deck = screen.getByRole("region", { name: "Deck A" });
    expect(within(deck).getByText("LIVE")).toBeInTheDocument();
    expect(within(deck).getByTestId("deck-A-title")).toHaveTextContent("Live Artist - Live Song");
    expect(within(deck).queryByRole("group", { name: "Deck A loops" })).not.toBeInTheDocument();
    expect(within(deck).queryByRole("group", { name: "Deck A pitch" })).not.toBeInTheDocument();
  });

  it("save a station, add it to Automix, load it from the queue", async () => {
    const { mock } = await renderApp();
    const strip = await openStrip();
    fireEvent.change(within(strip).getByRole("textbox", { name: "Station name" }), { target: { value: "Bravo" } });
    fireEvent.change(within(strip).getByRole("textbox", { name: "Stream address" }), {
      target: { value: "https://relay1.social3.hr/radio/8310/radio.mp3" },
    });
    fireEvent.change(within(strip).getByRole("spinbutton", { name: "Automix play minutes" }), { target: { value: "30" } });
    fireEvent.click(within(strip).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual([
        "stationSave",
        { id: null, name: "Bravo", url: "https://relay1.social3.hr/radio/8310/radio.mp3", playMinutes: 30 },
      ]);
    });
    expect(await within(strip).findByRole("option", { name: "Bravo" })).toBeInTheDocument();

    fireEvent.click(within(strip).getByRole("button", { name: "+ Automix" }));
    await waitFor(() => {
      expect(queue.get().map((e) => e.track.artist)).toEqual(["Internet radio"]);
    });
    const list = screen.getAllByRole("list", { name: "Automix queue" })[0];
    if (!list) throw new Error("no queue");
    const item = within(list).getByRole("listitem");
    expect(item).toHaveTextContent("Bravo");
    expect(item).toHaveTextContent("30:00");
    fireEvent.contextMenu(item, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu", { name: "Context menu" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Load to Deck B" }));
    await waitFor(() => {
      expect(mock.calls.some(([c, a]) => c === "deckLoadStation" && (a as { deck: string }).deck === "B")).toBe(true);
    });
  });
});
