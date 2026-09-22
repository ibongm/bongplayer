import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

/** Matches the 4 skins planned for Phase 8; only "midnight-slate" has CSS variables defined so far (Phase 1). */
export type ThemeId = "midnight-slate" | "pioneer-stealth" | "technics-silver" | "day-shift";

export interface PanelRatios {
  readonly left: number;
  readonly center: number;
  readonly right: number;
}

export interface ActiveContextMenu {
  readonly x: number;
  readonly y: number;
  /** Opaque identifier for what was right-clicked; Phase 4's ContextMenu component interprets this. */
  readonly targetId: string;
}

// Matches ImplementationPlan.md §1's ~20% / ~55% / ~25% three-column split.
const DEFAULT_PANEL_RATIOS: PanelRatios = { left: 0.2, center: 0.55, right: 0.25 };

export interface UIState {
  readonly shiftLocked: boolean;
  readonly theme: ThemeId;
  readonly panelRatios: PanelRatios;
  readonly activeContextMenu: ActiveContextMenu | null;

  toggleShiftLock(): void;
  setShiftLock(locked: boolean): void;
  setTheme(theme: ThemeId): void;
  setPanelRatios(ratios: PanelRatios): void;
  resetPanelRatios(): void;
  openContextMenu(menu: ActiveContextMenu): void;
  closeContextMenu(): void;
}

interface PersistedUIState {
  readonly theme: ThemeId;
  readonly panelRatios: PanelRatios;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        shiftLocked: false,
        theme: "midnight-slate",
        panelRatios: DEFAULT_PANEL_RATIOS,
        activeContextMenu: null,

        toggleShiftLock() {
          set((state) => ({ shiftLocked: !state.shiftLocked }), false, "toggleShiftLock");
        },

        setShiftLock(locked) {
          set({ shiftLocked: locked }, false, "setShiftLock");
        },

        setTheme(theme) {
          set({ theme }, false, "setTheme");
        },

        setPanelRatios(ratios) {
          set({ panelRatios: ratios }, false, "setPanelRatios");
        },

        resetPanelRatios() {
          set({ panelRatios: DEFAULT_PANEL_RATIOS }, false, "resetPanelRatios");
        },

        openContextMenu(menu) {
          set({ activeContextMenu: menu }, false, "openContextMenu");
        },

        closeContextMenu() {
          set({ activeContextMenu: null }, false, "closeContextMenu");
        },
      }),
      {
        name: "bongplayer-ui",
        // Only remembered preferences persist — shiftLocked and
        // activeContextMenu are momentary interaction state that shouldn't
        // silently reappear on the next launch.
        partialize: (state): PersistedUIState => ({
          theme: state.theme,
          panelRatios: state.panelRatios,
        }),
      },
    ),
    { name: "ui" },
  ),
);
