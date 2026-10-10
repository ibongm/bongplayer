// Skins: the four built-in colour sets (src/styles/theme.css) and skins imported from a file.
// Switching applies at once (every colour is a CSS variable; canvases read them each frame)
// and is saved.

import { backend } from "../ipc/backend";
import { notify } from "./app";
import { createStore } from "./store";
import { resetColorCache } from "./ui";

export const SKINS = [
  { id: "midnight-slate", name: "Midnight Slate", note: "Dark glass (default)" },
  { id: "pioneer-stealth", name: "Pioneer Stealth", note: "Black with orange highlights" },
  { id: "technics-silver", name: "Technics Silver", note: "Light silver, dark text" },
  { id: "day-shift", name: "Day Shift", note: "Bright, for daylight" },
] as const;

export type BuiltinSkin = (typeof SKINS)[number]["id"];
export const DEFAULT_SKIN: BuiltinSkin = "midnight-slate";

export const SKIN_KEY = "appearance.skin";
export const CUSTOM_SKINS_KEY = "appearance.custom_skins";

/** Colour variables a skin file may set (without the "--color-" prefix). */
export const COLOR_NAMES = [
  "bg",
  "surface",
  "surface-raised",
  "border",
  "text",
  "text-muted",
  "accent",
  "accent-2",
  "danger",
  "danger-text",
  "focus",
  "overlay",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export interface CustomSkin {
  name: string;
  base: BuiltinSkin;
  colors: Partial<Record<ColorName, string>>;
}

export interface SkinState {
  /** A built-in id, or "custom:<name>". */
  current: string;
  custom: CustomSkin[];
}

export const skins = createStore<SkinState>({ current: DEFAULT_SKIN, custom: [] });

function isBuiltin(v: unknown): v is BuiltinSkin {
  return typeof v === "string" && SKINS.some((s) => s.id === v);
}

function isColorName(v: string): v is ColorName {
  return (COLOR_NAMES as readonly string[]).includes(v);
}

/** Only plain colour values: #rgb, #rrggbb (+ alpha), or rgb()/hsl() with numbers. */
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN = /^(rgb|rgba|hsl|hsla)\([-0-9.%\s,/]+(deg)?[-0-9.%\s,/]*\)$/i;

export function isColorValue(v: string): boolean {
  const t = v.trim();
  return HEX.test(t) || FN.test(t);
}

export type ParsedSkin = { ok: true; skin: CustomSkin } | { ok: false; error: string };

/**
 * Reads a skin file:
 * `{ "name": "My skin", "base": "day-shift", "colors": { "accent": "#e11d48", … } }`.
 * Unknown colour names or values that are not plain colours are refused.
 */
export function parseSkin(text: string): ParsedSkin {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "the file is not valid JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: 'the file must hold an object with "name" and "colors"' };
  }
  const rec = data as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (name === "" || name.length > 40) return { ok: false, error: '"name" must be 1–40 characters' };
  const base = rec.base ?? DEFAULT_SKIN;
  if (!isBuiltin(base)) {
    return { ok: false, error: `"base" must be one of: ${SKINS.map((s) => s.id).join(", ")}` };
  }
  const raw = rec.colors;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '"colors" must be an object, e.g. { "accent": "#e11d48" }' };
  }
  const colors: Partial<Record<ColorName, string>> = {};
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!isColorName(k)) {
      unknown.push(k);
      continue;
    }
    if (typeof v !== "string" || !isColorValue(v)) {
      return { ok: false, error: `"${k}" is not a colour (use e.g. "#1a2230" or "rgb(26 34 48)")` };
    }
    colors[k] = v.trim();
  }
  if (unknown.length > 0) {
    return { ok: false, error: `unknown colour name(s): ${unknown.join(", ")} — allowed: ${COLOR_NAMES.join(", ")}` };
  }
  if (Object.keys(colors).length === 0) return { ok: false, error: "the skin sets no colours" };
  return { ok: true, skin: { name, base, colors } };
}

/** Puts a skin on the page: the base skin's variables, then any imported colours on top. */
export function applySkin(state: SkinState): void {
  const root = document.documentElement;
  const custom = state.current.startsWith("custom:")
    ? state.custom.find((c) => `custom:${c.name}` === state.current)
    : undefined;
  const base = custom ? custom.base : isBuiltin(state.current) ? state.current : DEFAULT_SKIN;
  root.setAttribute("data-theme", base);
  for (const n of COLOR_NAMES) root.style.removeProperty(`--color-${n}`);
  if (custom) {
    for (const [n, v] of Object.entries(custom.colors)) root.style.setProperty(`--color-${n}`, v);
  }
  // Canvases pick up the new colours on their next frame.
  resetColorCache();
}

function setState(next: SkinState): void {
  skins.set(next);
  applySkin(next);
}

function parseCustomList(text: string | null): CustomSkin[] {
  if (text === null) return [];
  try {
    const list: unknown = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const r = parseSkin(JSON.stringify(item));
      return r.ok ? [r.skin] : [];
    });
  } catch {
    return [];
  }
}

/** Reads the saved skin and applies it (at start-up). */
export async function loadSkin(): Promise<void> {
  const b = backend();
  const [cur, list] = await Promise.all([b.settingGet(SKIN_KEY), b.settingGet(CUSTOM_SKINS_KEY)]);
  const custom = parseCustomList(list.ok ? list.value : null);
  const saved = cur.ok ? cur.value : null;
  const known = saved !== null && (isBuiltin(saved) || custom.some((c) => `custom:${c.name}` === saved));
  setState({ current: known ? saved : DEFAULT_SKIN, custom });
}

export async function chooseSkin(id: string): Promise<void> {
  setState({ ...skins.get(), current: id });
  const r = await backend().settingSet(SKIN_KEY, id);
  if (!r.ok) notify("error", `Could not save the skin: ${r.error}`);
}

async function saveCustom(custom: CustomSkin[]): Promise<boolean> {
  const r = await backend().settingSet(CUSTOM_SKINS_KEY, JSON.stringify(custom));
  if (!r.ok) notify("error", `Could not save the skins: ${r.error}`);
  return r.ok;
}

/** Adds (or replaces, by name) an imported skin and switches to it. */
export async function importSkin(text: string): Promise<boolean> {
  const parsed = parseSkin(text);
  if (!parsed.ok) {
    notify("error", `Skin file: ${parsed.error}`);
    return false;
  }
  const custom = [...skins.get().custom.filter((c) => c.name !== parsed.skin.name), parsed.skin];
  skins.set({ ...skins.get(), custom });
  if (!(await saveCustom(custom))) return false;
  await chooseSkin(`custom:${parsed.skin.name}`);
  notify("info", `Skin “${parsed.skin.name}” imported`);
  return true;
}

export async function deleteSkin(name: string): Promise<void> {
  const s = skins.get();
  const custom = s.custom.filter((c) => c.name !== name);
  skins.set({ ...s, custom });
  await saveCustom(custom);
  if (s.current === `custom:${name}`) await chooseSkin(DEFAULT_SKIN);
}
