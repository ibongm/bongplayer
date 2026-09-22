/**
 * Frontend side of the local Icecast/Shoutcast proxy (Phase 8) — see
 * src-tauri/src/radio.rs for the actual TCP proxy and ICY metadata parsing.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const TITLE_CHANGED_EVENT = "radio://title-changed";

/** Tunes the local proxy to a new station and returns the local proxy URL — point an `<audio>` element's `src` at this, not the original stream URL. */
export async function tuneRadioStation(url: string): Promise<string> {
  try {
    return await invoke<string>("tune_radio_station", { url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to tune radio station: ${message}`, { cause: error });
  }
}

/** Subscribes to "now playing" title updates extracted from the stream's ICY metadata. Returns an unsubscribe function. */
export async function onRadioTitleChanged(callback: (title: string) => void): Promise<UnlistenFn> {
  return listen<string>(TITLE_CHANGED_EVENT, (event) => callback(event.payload));
}
