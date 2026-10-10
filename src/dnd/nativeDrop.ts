// Files and folders dragged in from Windows Explorer (Tauri's native drag-drop event).

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { dragBegin, dragCancel, dragEnd, dragMove, dragStore } from "./drag";

function label(paths: string[]): string {
  const first = paths[0]?.split(/[\\/]/).pop() ?? "";
  return paths.length === 1 ? first : `${paths.length} items`;
}

/** Starts listening; returns a function that stops. Does nothing outside the desktop app. */
export async function listenNativeDrops(): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
    const p = event.payload;
    const scale = window.devicePixelRatio || 1;
    switch (p.type) {
      case "enter": {
        const { x, y } = p.position;
        dragBegin({ kind: "files", paths: p.paths, label: label(p.paths) }, x / scale, y / scale);
        break;
      }
      case "over":
        if (dragStore.get()) dragMove(p.position.x / scale, p.position.y / scale);
        break;
      case "drop": {
        const { x, y } = p.position;
        if (!dragStore.get()) {
          dragBegin({ kind: "files", paths: p.paths, label: label(p.paths) }, x / scale, y / scale);
        }
        void dragEnd(x / scale, y / scale);
        break;
      }
      case "leave":
        dragCancel();
        break;
    }
  });
  return unlisten;
}
