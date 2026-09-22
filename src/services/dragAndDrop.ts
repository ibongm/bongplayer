/**
 * Drag-and-drop coordination (AGENTS §2.3): an internal HTML5 drag protocol
 * for dragging track rows within the app, plus a native-OS file drop
 * registry for files dropped in from Windows Explorer.
 */

const TRACK_DRAG_MIME_TYPE = "application/x-bongplayer-track";

export interface DraggedTrackPayload {
  readonly filePath: string;
  readonly fileName: string;
}

function isDraggedTrackPayload(value: unknown): value is DraggedTrackPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.filePath === "string" && typeof record.fileName === "string";
}

/** Call from a track row's onDragStart. */
export function beginTrackDrag(event: DragEvent, payload: DraggedTrackPayload): void {
  event.dataTransfer?.setData(TRACK_DRAG_MIME_TYPE, JSON.stringify(payload));
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = "copy";
  }
}

/** Call from a drop target's onDragOver to accept — and visually indicate — an internal track drag. */
export function allowTrackDrop(event: DragEvent): void {
  if (event.dataTransfer?.types.includes(TRACK_DRAG_MIME_TYPE) === true) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
}

/** Call from a drop target's onDrop. Returns null (and does nothing) if this wasn't an internal track drag. */
export function readTrackDrop(event: DragEvent): DraggedTrackPayload | null {
  const raw = event.dataTransfer?.getData(TRACK_DRAG_MIME_TYPE);
  if (raw === undefined || raw === "") return null;
  event.preventDefault();
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDraggedTrackPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --- Native OS file drop (Windows Explorer -> window) ---

export type DropZoneKind = "deck-a" | "deck-b" | "automix" | "folder-tree";

const DROP_ZONE_ATTRIBUTE = "data-drop-zone";
const DROP_ZONE_KINDS: readonly DropZoneKind[] = ["deck-a", "deck-b", "automix", "folder-tree"];

/** Marks an element as a native-file drop target. Call once the element mounts (e.g. via a ref callback). */
export function registerDropZone(element: HTMLElement, kind: DropZoneKind): void {
  element.setAttribute(DROP_ZONE_ATTRIBUTE, kind);
}

const dropHandlers = new Map<DropZoneKind, (paths: readonly string[]) => void>();

/** Registers the handler a drop zone runs when files land on it; returns an unregister function. */
export function setDropZoneHandler(
  kind: DropZoneKind,
  onDrop: (paths: readonly string[]) => void,
): () => void {
  dropHandlers.set(kind, onDrop);
  return () => {
    if (dropHandlers.get(kind) === onDrop) {
      dropHandlers.delete(kind);
    }
  };
}

function isDropZoneKind(value: string | null): value is DropZoneKind {
  return value !== null && (DROP_ZONE_KINDS as readonly string[]).includes(value);
}

function resolveDropZoneKindAtPoint(logicalX: number, logicalY: number): DropZoneKind | null {
  const element = document.elementFromPoint(logicalX, logicalY);
  const zoneElement = element?.closest(`[${DROP_ZONE_ATTRIBUTE}]`);
  const kind = zoneElement?.getAttribute(DROP_ZONE_ATTRIBUTE) ?? null;
  return isDropZoneKind(kind) ? kind : null;
}

/**
 * Starts listening for native OS file drops on the current window, routing
 * each drop to whichever registered zone (see registerDropZone/
 * setDropZoneHandler) sits under the drop point. Call once at app startup;
 * returns an unlisten function for cleanup.
 */
export async function initNativeFileDropListener(): Promise<() => void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;
    const dpr = window.devicePixelRatio || 1;
    const kind = resolveDropZoneKindAtPoint(
      event.payload.position.x / dpr,
      event.payload.position.y / dpr,
    );
    if (kind === null) return;
    dropHandlers.get(kind)?.(event.payload.paths);
  });
  return unlisten;
}
