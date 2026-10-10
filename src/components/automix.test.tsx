// M5 (UI side): Automix cockpit, LOCK (PIN / hold), DUCK, master transport, DAY view,
// Automix and Lock settings.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn() }));

import { backend } from "../ipc/backend";
import { queue, status } from "../state/app";
import { renderApp, type Mock } from "../test/renderApp";
import { HOLD_MS } from "./LockDuck";

async function sync(): Promise<void> {
  const r = await backend().engineStatus();
  if (!r.ok) throw new Error(r.error);
  act(() => {
    status.set(r.value);
  });
}

async function queueHouse(mock: Mock, n: number): Promise<void> {
  const r = await mock.folderTracks("C:\\Users\\dj\\Music\\House");
  if (!r.ok) throw new Error("tracks");
  const q = await mock.queueAdd(r.value.rows.slice(0, n).map((t) => t.id), null);
  if (q.ok) {
    act(() => {
      queue.set(q.value);
    });
  }
}

function called(mock: Mock, name: string): unknown[] {
  return mock.calls.filter(([c]) => c === name).map(([, a]) => a);
}

describe("Automix cockpit", () => {
  it("start, skip, stop and settings", async () => {
    const { mock } = await renderApp();
    await queueHouse(mock, 3);
    await sync();
    const cockpit = screen.getAllByRole("group", { name: "Automix controls" })[0];
    if (!cockpit) throw new Error("no cockpit");
    fireEvent.click(within(cockpit).getByRole("button", { name: /START AUTOMIX/ }));
    await waitFor(() => {
      expect(called(mock, "automixStart")).toHaveLength(1);
    });
    await sync();
    expect(within(cockpit).getByRole("button", { name: /AUTOMIX ON/ })).toHaveAttribute("aria-pressed", "true");
    // The playing entry is marked in the queue.
    const list = screen.getAllByRole("list", { name: "Automix queue" })[0];
    if (!list) throw new Error("no list");
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("▶");

    fireEvent.click(within(cockpit).getByRole("button", { name: /Skip/ }));
    await waitFor(() => {
      expect(called(mock, "automixSkip")).toHaveLength(1);
    });

    fireEvent.change(within(cockpit).getByRole("spinbutton", { name: "Trigger" }), { target: { value: "12" } });
    await waitFor(() => {
      expect(called(mock, "automixConfig").at(-1)).toMatchObject({ triggerSeconds: 12 });
    });
    await sync();
    fireEvent.change(within(cockpit).getByRole("combobox", { name: "Transition style" }), { target: { value: "echoOut" } });
    await waitFor(() => {
      expect(called(mock, "automixConfig").at(-1)).toMatchObject({ style: "echoOut", triggerSeconds: 12 });
    });
    await sync();
    for (const label of ["Shuffle", "Auto-remove"]) {
      fireEvent.click(within(cockpit).getByRole("button", { name: label }));
      await sync();
    }
    expect(called(mock, "automixConfig").at(-1)).toMatchObject({ shuffle: true, autoRemove: true });

    fireEvent.click(within(cockpit).getByRole("button", { name: /AUTOMIX ON/ }));
    await waitFor(() => {
      expect(called(mock, "automixStop")).toHaveLength(1);
    });
  });
});

describe("LOCK", () => {
  it("locks; a locked deck refuses PLAY; wrong PIN fails, right PIN unlocks", async () => {
    const { mock } = await renderApp();
    await mock.lockConfigure(true, false, null, "2468");
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    await waitFor(() => {
      expect(called(mock, "lockEngage")).toHaveLength(1);
    });
    await sync();
    const locked = screen.getByRole("button", { name: /Locked — unlock/ });
    expect(locked).toHaveTextContent("LOCKED");

    // Music controls are refused while locked (by the backend, shown to the user).
    fireEvent.keyDown(window, { key: "F1" });
    expect(await screen.findByText(/Locked — unlock with the PIN/)).toBeInTheDocument();

    fireEvent.click(locked);
    let dialog = await screen.findByRole("dialog", { name: "Unlock" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "1111" } });
    fireEvent.submit(dialog);
    expect(await screen.findByText(/Unlock: Wrong PIN/)).toBeInTheDocument();
    await sync();
    expect(status.get()?.locked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Locked — unlock/ }));
    dialog = await screen.findByRole("dialog", { name: "Unlock" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "2468" } });
    fireEvent.submit(dialog);
    await waitFor(async () => {
      await sync();
      expect(status.get()?.locked).toBe(false);
    });
  });

  it("holding LOCK for 2 seconds unlocks (when allowed)", async () => {
    const { mock } = await renderApp();
    await mock.lockEngage();
    await sync();
    vi.useFakeTimers();
    const btn = screen.getByRole("button", { name: /Locked — unlock/ });
    fireEvent.pointerDown(btn, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS - 100);
    });
    expect(called(mock, "lockRelease")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    vi.useRealTimers();
    expect(called(mock, "lockRelease")).toContainEqual({ pin: null, hold: true });
    fireEvent.pointerUp(btn);
  });
});

describe("DUCK and master transport", () => {
  it("DUCK button and the D key", async () => {
    const { mock } = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "DUCK" }));
    await waitFor(() => {
      expect(called(mock, "duck")).toEqual([true]);
    });
    await sync();
    expect(screen.getByRole("button", { name: "DUCK" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "d" });
    await waitFor(() => {
      expect(called(mock, "duck")).toEqual([true, false]);
    });
  });

  it("master PLAY / PAUSE / STOP", async () => {
    const { mock } = await renderApp();
    const group = screen.getByRole("group", { name: "Master transport" });
    for (const a of ["play", "pause", "stop"]) {
      fireEvent.click(within(group).getByRole("button", { name: `Master ${a}` }));
    }
    await waitFor(() => {
      expect(called(mock, "masterTransport")).toEqual(["play", "pause", "stop"]);
    });
  });
});

describe("DAY view", () => {
  it("shows what is playing and offers big START / NEXT / DUCK / LOCK", async () => {
    const { mock } = await renderApp();
    await queueHouse(mock, 2);
    fireEvent.keyDown(window, { key: "4", ctrlKey: true });
    expect(screen.getByRole("region", { name: "Now playing" })).toHaveTextContent("Nothing is playing");
    fireEvent.click(screen.getByRole("button", { name: "▶ START" }));
    await waitFor(() => {
      expect(called(mock, "automixStart")).toHaveLength(1);
    });
    await sync();
    expect(screen.getByTestId("day-title")).toHaveTextContent("House Track 01");
    expect(screen.getByRole("region", { name: "Up next" })).toHaveTextContent("House Track 02");
    expect(screen.getByRole("button", { name: "⏭ NEXT" })).toBeEnabled();
  });
});

describe("Settings: Automix and Lock tabs", () => {
  it("saves Automix defaults and sets a PIN", async () => {
    const { mock } = await renderApp();
    await sync();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Automix" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Shuffle" }));
    await waitFor(() => {
      expect(called(mock, "automixConfig").at(-1)).toMatchObject({ shuffle: true });
    });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Lock" }));
    const newPin = await within(dialog).findByLabelText("New PIN");
    fireEvent.change(newPin, { target: { value: "13579" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Set PIN" }));
    await waitFor(() => {
      expect(called(mock, "lockConfigure").at(-1)).toMatchObject({ newPin: "13579" });
    });
    expect(await within(dialog).findByText("PIN (set)")).toBeInTheDocument();
  });
});
