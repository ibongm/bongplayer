// Sampler pads as the screen sees them, and the actions on them. Every action reports
// errors as a visible notice.

import { backend } from "../ipc/backend";
import type { IpcResult, PadInfo } from "../ipc/types";
import { notify } from "./app";
import { createStore } from "./store";

export const PAD_COUNT = 8;

/** The Sampler strip under the top bar (SAMPLER button, Ctrl+P). */
export const samplerOpen = createStore(false);

export const pads = createStore<PadInfo[]>([]);

function take(r: IpcResult<PadInfo[]>, context: string): boolean {
  if (r.ok) {
    pads.set(r.value);
    return true;
  }
  notify("error", `${context}: ${r.error}`);
  return false;
}

export async function refreshPads(): Promise<void> {
  const r = await backend().samplerPads();
  if (r.ok) pads.set(r.value);
  else notify("error", `Sampler: ${r.error}`);
}

export async function loadPad(pad: number, path: string): Promise<void> {
  notify("info", `Loading pad ${pad + 1}…`);
  take(await backend().samplerLoad(pad, path), `Pad ${pad + 1}`);
}

export async function clearPad(pad: number): Promise<void> {
  take(await backend().samplerClear(pad), `Pad ${pad + 1}`);
}

export async function configurePad(pad: number, gainDb: number, choke: number): Promise<void> {
  take(await backend().samplerConfigure(pad, gainDb, choke), `Pad ${pad + 1}`);
}

export async function triggerPad(pad: number): Promise<void> {
  const r = await backend().samplerTrigger(pad);
  if (!r.ok) notify("error", `Pad ${pad + 1}: ${r.error}`);
}

export async function stopPads(pad: number | null): Promise<void> {
  const r = await backend().samplerStop(pad);
  if (!r.ok) notify("error", `Sampler: ${r.error}`);
}
