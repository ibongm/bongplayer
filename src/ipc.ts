import { invoke, isTauri } from "@tauri-apps/api/core";

/** Payload of the `app_info` Rust command (src-tauri/src/lib.rs). */
export interface AppInfo {
  name: string;
  version: string;
}

/** Every IPC call resolves to this; it never rejects, so the UI always gets a visible state. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Answers used when the UI runs alone in a browser (`npm run dev`), without the Rust side. */
const browserMock = {
  app_info: (): AppInfo => ({ name: "BongPlayer", version: "dev (browser, no Rust)" }),
} satisfies Record<string, () => unknown>;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function isAppInfo(value: unknown): value is AppInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.version === "string";
}

export async function getAppInfo(): Promise<IpcResult<AppInfo>> {
  try {
    const value: unknown = isTauri() ? await invoke("app_info") : browserMock.app_info();
    if (!isAppInfo(value)) {
      return { ok: false, error: "app_info returned an unexpected shape" };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
