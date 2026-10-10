// Feeds the ~60 Hz engine status into the `status` store: Tauri event in the app,
// polling the mock in a browser.

import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { backend } from "../ipc/backend";
import { isStatusSnapshot } from "../ipc/guards";
import { notify, status } from "./app";

export async function startStatusFeed(): Promise<() => void> {
  if (isTauri()) {
    let warned = false;
    return listen("engine-status", (e) => {
      if (isStatusSnapshot(e.payload)) status.set(e.payload);
      else if (!warned) {
        warned = true;
        notify("error", "The audio engine sent an unexpected status; the deck display may be wrong.");
      }
    });
  }
  const id = window.setInterval(() => {
    void backend()
      .engineStatus()
      .then((r) => {
        if (r.ok) status.set(r.value);
      });
  }, 50);
  return () => {
    window.clearInterval(id);
  };
}
