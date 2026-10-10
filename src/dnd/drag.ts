// Drag & drop without HTML5 drag events (Tauri's native file-drop handler disables those on
// Windows). Internal drags use pointer events; files from Windows Explorer arrive through
// Tauri's drag-drop event (see nativeDrop.ts). Both end up in `performDrop`.
//
// Drop targets are plain elements marked with `data-drop="<type>"` and optionally
// `data-drop-value="<value>"`. The element under the pointer is found with
// `document.elementFromPoint`, so targets need no registration.

import { createStore } from "../state/store";

export type DragPayload =
  | { kind: "tracks"; trackIds: number[]; label: string }
  | { kind: "queue"; uids: number[]; trackIds: number[]; label: string }
  | { kind: "files"; paths: string[]; label: string };

export type DropType = "deck" | "queue" | "queue-item" | "crate" | "folder-tree" | "pad";

export interface DropTarget {
  type: DropType;
  value: string | null;
  el: Element;
}

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  target: DropTarget | null;
}

export const dragStore = createStore<DragState | null>(null);

const DROP_TYPES: readonly DropType[] = ["deck", "queue", "queue-item", "crate", "folder-tree", "pad"];

function isDropType(v: string | undefined): v is DropType {
  return v !== undefined && (DROP_TYPES as readonly string[]).includes(v);
}

/** Whether a payload may be dropped on a target type. */
export function accepts(payload: DragPayload, type: DropType): boolean {
  switch (type) {
    case "deck":
    case "queue":
    case "queue-item":
      return true;
    case "crate":
      return payload.kind !== "queue";
    case "folder-tree":
      return payload.kind === "files";
    case "pad":
      return payload.kind !== "queue";
  }
}

export function targetAt(x: number, y: number, payload: DragPayload): DropTarget | null {
  let el: Element | null = document.elementFromPoint(x, y);
  // Walk up: an inner target that refuses the payload may sit inside an outer one that takes it.
  while (el) {
    const found: Element | null = el.closest("[data-drop]");
    if (!found) return null;
    const type = found.getAttribute("data-drop") ?? undefined;
    if (isDropType(type) && accepts(payload, type)) {
      return { type, value: found.getAttribute("data-drop-value"), el: found };
    }
    el = found.parentElement;
  }
  return null;
}

let highlighted: Element | null = null;

function highlight(el: Element | null): void {
  if (highlighted === el) return;
  highlighted?.removeAttribute("data-drop-active");
  el?.setAttribute("data-drop-active", "true");
  highlighted = el;
}

/** Moves an active drag (internal or native) to a point. */
export function dragMove(x: number, y: number): void {
  const d = dragStore.get();
  if (!d) return;
  const target = targetAt(x, y, d.payload);
  highlight(target?.el ?? null);
  dragStore.set({ ...d, x, y, target });
}

export function dragBegin(payload: DragPayload, x: number, y: number): void {
  dragStore.set({ payload, x, y, target: null });
  dragMove(x, y);
}

export function dragCancel(): void {
  highlight(null);
  dragStore.set(null);
}

type DropHandler = (payload: DragPayload, target: DropTarget) => Promise<void>;
let dropHandler: DropHandler | null = null;

/** The app installs the function that carries out drops (see drop.ts). */
export function setDropHandler(handler: DropHandler): void {
  dropHandler = handler;
}

/** Ends a drag at a point; returns the drop's promise (resolved when the action is done). */
export function dragEnd(x: number, y: number): Promise<void> {
  const d = dragStore.get();
  if (!d) return Promise.resolve();
  const target = targetAt(x, y, d.payload);
  dragCancel();
  if (!target || !dropHandler) return Promise.resolve();
  return dropHandler(d.payload, target);
}

const THRESHOLD = 5;

/** Last drop started by a pointer drag (tests await it). */
export let lastDrop: Promise<void> = Promise.resolve();

/**
 * Call from `onPointerDown` on a draggable element. The drag starts once the pointer has
 * moved a few pixels with the button held; a plain click is left alone.
 */
export function startPointerDrag(e: React.PointerEvent, makePayload: () => DragPayload | null): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const onMove = (ev: PointerEvent): void => {
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      const payload = makePayload();
      if (!payload) {
        cleanup();
        return;
      }
      started = true;
      dragBegin(payload, ev.clientX, ev.clientY);
      return;
    }
    dragMove(ev.clientX, ev.clientY);
  };
  const onUp = (ev: PointerEvent): void => {
    cleanup();
    if (started) {
      // Swallow the click that follows a drag so it does not change the selection.
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => {
        window.removeEventListener("click", swallow, { capture: true });
      }, 0);
      lastDrop = dragEnd(ev.clientX, ev.clientY);
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && started) {
      ev.preventDefault();
      cleanup();
      dragCancel();
    }
  };
  const swallow = (ev: Event): void => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  function cleanup(): void {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}
