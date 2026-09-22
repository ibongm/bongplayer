import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./useUIStore";

// zustand's persist middleware writes to localStorage by default, which
// doesn't exist in Vitest's Node test environment — verified it no-ops
// gracefully rather than throwing, so no storage mock is needed here.

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true);
});

describe("useUIStore", () => {
  it("has the documented default state", () => {
    const state = useUIStore.getState();
    expect(state.shiftLocked).toBe(false);
    expect(state.theme).toBe("midnight-slate");
    expect(state.panelRatios).toEqual({ left: 0.2, center: 0.55, right: 0.25 });
    expect(state.activeContextMenu).toBeNull();
  });

  it("toggles and sets shift lock", () => {
    useUIStore.getState().toggleShiftLock();
    expect(useUIStore.getState().shiftLocked).toBe(true);
    useUIStore.getState().setShiftLock(false);
    expect(useUIStore.getState().shiftLocked).toBe(false);
  });

  it("sets the theme", () => {
    useUIStore.getState().setTheme("pioneer-stealth");
    expect(useUIStore.getState().theme).toBe("pioneer-stealth");
  });

  it("sets and resets panel ratios", () => {
    useUIStore.getState().setPanelRatios({ left: 0.3, center: 0.4, right: 0.3 });
    expect(useUIStore.getState().panelRatios).toEqual({ left: 0.3, center: 0.4, right: 0.3 });
    useUIStore.getState().resetPanelRatios();
    expect(useUIStore.getState().panelRatios).toEqual({ left: 0.2, center: 0.55, right: 0.25 });
  });

  it("opens and closes the context menu", () => {
    useUIStore.getState().openContextMenu({ x: 10, y: 20, targetId: "deck-a" });
    expect(useUIStore.getState().activeContextMenu).toEqual({ x: 10, y: 20, targetId: "deck-a" });
    useUIStore.getState().closeContextMenu();
    expect(useUIStore.getState().activeContextMenu).toBeNull();
  });
});
