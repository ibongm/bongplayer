// Multi-selection rules for lists and tables, as pure functions:
// click = select one; Ctrl+click = toggle; Shift+click = range from the anchor;
// Ctrl+Shift+click = add range; Ctrl+A = all; Esc = none.

export interface Selection {
  keys: ReadonlySet<string>;
  /** Index where a Shift range starts. */
  anchor: number | null;
  /** Index of the row with keyboard focus (the "focused" row). */
  focus: number | null;
}

export const emptySelection: Selection = { keys: new Set(), anchor: null, focus: null };

export interface Modifiers {
  ctrl: boolean;
  shift: boolean;
}

function range(order: readonly string[], a: number, b: number): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

export function clickRow(
  sel: Selection,
  order: readonly string[],
  index: number,
  mods: Modifiers,
): Selection {
  const key = order[index];
  if (key === undefined) return sel;
  if (mods.shift) {
    const anchor = sel.anchor ?? index;
    const keys = new Set(mods.ctrl ? sel.keys : []);
    range(order, anchor, index).forEach((k) => keys.add(k));
    return { keys, anchor, focus: index };
  }
  if (mods.ctrl) {
    const keys = new Set(sel.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    return { keys, anchor: index, focus: index };
  }
  return { keys: new Set([key]), anchor: index, focus: index };
}

export function selectAll(order: readonly string[]): Selection {
  return {
    keys: new Set(order),
    anchor: order.length > 0 ? 0 : null,
    focus: order.length > 0 ? order.length - 1 : null,
  };
}

/** Moves focus with the arrow keys; Shift extends the selection from the anchor. */
export function moveFocus(
  sel: Selection,
  order: readonly string[],
  delta: number,
  extend: boolean,
): Selection {
  if (order.length === 0) return sel;
  const from = sel.focus ?? (delta > 0 ? -1 : order.length);
  const index = Math.max(0, Math.min(order.length - 1, from + delta));
  if (extend) {
    const anchor = sel.anchor ?? index;
    return { keys: new Set(range(order, anchor, index)), anchor, focus: index };
  }
  return clickRow(sel, order, index, { ctrl: false, shift: false });
}

/** Drops keys that are no longer in the list (after a refresh); keeps the rest. */
export function prune(sel: Selection, order: readonly string[]): Selection {
  const present = new Set(order);
  const keys = new Set([...sel.keys].filter((k) => present.has(k)));
  const clamp = (i: number | null): number | null =>
    i === null || order.length === 0 ? null : Math.min(i, order.length - 1);
  return { keys, anchor: clamp(sel.anchor), focus: clamp(sel.focus) };
}

/** Selected keys in list order. */
export function selectedInOrder(sel: Selection, order: readonly string[]): string[] {
  return order.filter((k) => sel.keys.has(k));
}
