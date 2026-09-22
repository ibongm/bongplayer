/**
 * Phase 8's 4 skins. `THEMES`' color values are the source of truth for
 * canvas-drawn UI (kept in sync manually with the `[data-theme="..."]`
 * blocks in src/index.css, which are what every Tailwind `bg-accent`/
 * `text-textMuted`/etc. class in the DOM actually resolves through) — a
 * <canvas> 2D context can't read a CSS custom property directly, so
 * anything drawn to one (WaveformCanvas's bars/playhead) must ask this
 * module for a literal color string and redraw when the active theme
 * changes, rather than relying on the CSS cascade the way DOM elements do.
 */

import type { ThemeId } from "../store/useUIStore";

export interface ThemeColors {
  /** "r g b" triplet, matching src/index.css's custom-property format. */
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly accent: string;
  readonly textPrimary: string;
  readonly textMuted: string;
}

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly label: string;
  readonly colors: ThemeColors;
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "midnight-slate",
    label: "Midnight Slate",
    colors: {
      surface: "17 19 23",
      surfaceRaised: "27 30 36",
      accent: "56 189 248",
      textPrimary: "241 245 249",
      textMuted: "148 163 184",
    },
  },
  {
    id: "pioneer-stealth",
    label: "Pioneer Stealth",
    colors: {
      surface: "10 10 12",
      surfaceRaised: "20 20 24",
      accent: "255 111 0",
      textPrimary: "245 245 245",
      textMuted: "156 156 163",
    },
  },
  {
    id: "technics-silver",
    label: "Technics Silver",
    colors: {
      surface: "196 196 200",
      surfaceRaised: "214 214 218",
      accent: "37 99 235",
      textPrimary: "24 24 27",
      textMuted: "82 82 91",
    },
  },
  {
    id: "day-shift",
    label: "Day Shift",
    colors: {
      surface: "250 250 250",
      surfaceRaised: "255 255 255",
      accent: "5 150 105",
      textPrimary: "24 24 27",
      textMuted: "113 113 122",
    },
  },
];

export function themeById(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** Sets `data-theme` on `<html>`, the single attribute src/index.css's `[data-theme="..."]` blocks (and therefore every Tailwind skin-aware class) key off of. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

/** A theme's accent color as a literal `rgb(r g b)` string, for canvas contexts that can't read CSS custom properties. */
export function themeAccentColor(id: ThemeId): string {
  return `rgb(${themeById(id).colors.accent})`;
}

export function themeSurfaceColor(
  id: ThemeId,
  variant: "surface" | "surfaceRaised" = "surface",
): string {
  const { colors } = themeById(id);
  return `rgb(${variant === "surface" ? colors.surface : colors.surfaceRaised})`;
}

export function themeTextColor(id: ThemeId, variant: "primary" | "muted" = "primary"): string {
  const { colors } = themeById(id);
  return `rgb(${variant === "primary" ? colors.textPrimary : colors.textMuted})`;
}
