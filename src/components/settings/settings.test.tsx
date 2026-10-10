// M10 acceptance (UI): Settings tabs; switching skin updates every colour live and is saved;
// canvases read the new colours; skin import from a file (strictly checked); Library, Radio
// and Keyboard shortcuts tabs.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(() => Promise.resolve(false)),
}));

import { isTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { backend } from "../../ipc/backend";
import { DEFAULT_SKIN, applySkin, loadSkin, parseSkin, skins } from "../../state/skins";
import { cssColor } from "../../state/ui";
import { renderApp } from "../../test/renderApp";

function openSettings(tab: string): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  fireEvent.click(within(dialog).getByRole("tab", { name: tab }));
  return dialog;
}

const RED_SKIN = JSON.stringify({ name: "Bar Red", base: "pioneer-stealth", colors: { accent: "#e11d48", focus: "#e11d48" } });

describe("skin files", () => {
  it("accept plain colours and refuse everything else", () => {
    const ok = parseSkin(RED_SKIN);
    expect(ok).toEqual({ ok: true, skin: { name: "Bar Red", base: "pioneer-stealth", colors: { accent: "#e11d48", focus: "#e11d48" } } });
    expect(parseSkin('{"name":"x","colors":{"bg":"rgb(10 20 30 / 0.5)","text":"hsl(210deg 20% 90%)"}}').ok).toBe(true);
    const bad = (text: string): string => {
      const r = parseSkin(text);
      if (r.ok) throw new Error(`accepted: ${text}`);
      return r.error;
    };
    expect(bad("not json")).toMatch(/not valid JSON/);
    expect(bad('{"colors":{"bg":"#000"}}')).toMatch(/name/);
    expect(bad('{"name":"x","base":"virtualdj","colors":{"bg":"#000"}}')).toMatch(/base/);
    expect(bad('{"name":"x","colors":{"background":"#000"}}')).toMatch(/unknown colour name.*background/);
    // Nothing but a colour may get into the page.
    expect(bad('{"name":"x","colors":{"bg":"red; background: url(http://x)"}}')).toMatch(/not a colour/);
    expect(bad('{"name":"x","colors":{"bg":"url(x)"}}')).toMatch(/not a colour/);
    expect(bad('{"name":"x","colors":{"bg":"rgb(0,0,0) ; }"}}')).toMatch(/not a colour/);
    expect(bad('{"name":"x","colors":{}}')).toMatch(/no colours/);
  });
});

describe("Settings", () => {
  it("has every tab from the plan", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const names = within(dialog)
      .getAllByRole("tab")
      .map((t) => t.textContent);
    expect(names).toEqual(["Appearance", "Audio", "Library", "Automix", "Lock", "Radio", "Internet", "Keyboard shortcuts", "MIDI"]);
  });

  it("switching skin changes the colours at once and is remembered", async () => {
    const { mock } = await renderApp();
    expect(document.documentElement.getAttribute("data-theme")).toBe("midnight-slate");
    const dialog = openSettings("Appearance");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Day Shift/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("day-shift");
    await waitFor(async () => {
      expect(await mock.settingGet("appearance.skin")).toEqual({ ok: true, value: "day-shift" });
    });
    // Start-up reads it back.
    act(() => {
      skins.set({ current: DEFAULT_SKIN, custom: [] });
      applySkin(skins.get());
    });
    await act(async () => {
      await loadSkin();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("day-shift");
  });

  it("imports a skin file, switches to it (canvases see the new colour) and deletes it", async () => {
    await renderApp({ skinFiles: { "C:\\Skins\\red.json": RED_SKIN } });
    const dialog = openSettings("Appearance");
    const before = cssColor("--color-accent");
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(openDialog).mockResolvedValue("C:\\Skins\\red.json");
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Import skin file…" }));
      const radio = await within(dialog).findByRole("radio", { name: /Bar Red/ });
      expect(radio).toBeChecked();
    } finally {
      vi.mocked(isTauri).mockReturnValue(false);
    }
    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("pioneer-stealth");
    expect(root.style.getPropertyValue("--color-accent")).toBe("#e11d48");
    // The colour cache was reset, so the next canvas frame draws in the new accent.
    expect(cssColor("--color-accent")).toBe("#e11d48");
    expect(cssColor("--color-accent")).not.toBe(before);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete skin Bar Red" }));
    await waitFor(() => {
      expect(root.getAttribute("data-theme")).toBe("midnight-slate");
    });
    expect(root.style.getPropertyValue("--color-accent")).toBe("");
    expect(within(dialog).queryByRole("radio", { name: /Bar Red/ })).toBeNull();
  });

  it("a bad skin file is refused with the reason", async () => {
    await renderApp({ skinFiles: { "C:\\Skins\\bad.json": '{"name":"Bad","colors":{"glow":"#fff"}}' } });
    const dialog = openSettings("Appearance");
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(openDialog).mockResolvedValue("C:\\Skins\\bad.json");
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Import skin file…" }));
      await screen.findByText(/Skin file: unknown colour name\(s\): glow/);
    } finally {
      vi.mocked(isTauri).mockReturnValue(false);
    }
    expect(document.documentElement.getAttribute("data-theme")).toBe("midnight-slate");
  });

  it("Library tab shows the library and switches table columns", async () => {
    const { mock } = await renderApp();
    await mock.folderTracks("C:\\Users\\dj\\Music\\House");
    const dialog = openSettings("Library");
    await within(dialog).findByText(/library\.db/);
    expect(within(dialog).getByTestId("library-tracks")).toHaveTextContent("40");
    expect(screen.queryByRole("columnheader", { name: "Album" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Album" }));
    expect(screen.getByRole("columnheader", { name: "Album" })).toBeInTheDocument();
    await waitFor(async () => {
      const r = await mock.settingGet("table.columns");
      expect(r.ok && r.value?.includes("album")).toBe(true);
    });
  });

  it("Radio tab lists saved stations and deletes one after asking", async () => {
    await renderApp();
    await backend().stationSave(null, "Test FM", "http://example.test/stream", 45);
    const dialog = openSettings("Radio");
    const list = await within(dialog).findByRole("list", { name: "Saved stations" });
    await within(list).findByText("Test FM");
    expect(list).toHaveTextContent("45 min");
    fireEvent.click(within(list).getByRole("button", { name: "Delete station Test FM" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(within(dialog).queryByText("Test FM")).toBeNull();
    });
  });

  it("Keyboard shortcuts tab lists the keys", async () => {
    await renderApp();
    const dialog = openSettings("Keyboard shortcuts");
    const table = within(dialog).getByRole("table", { name: "Keyboard shortcuts" });
    for (const key of ["F1 / F5", "Ctrl+K", "Ctrl+P", "Alt+1 … 8", "Ctrl+Y"]) {
      expect(within(table).getByText(key)).toBeInTheDocument();
    }
  });
});
