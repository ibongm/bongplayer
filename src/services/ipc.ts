import { invoke } from "@tauri-apps/api/core";

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Strongly typed Tauri IPC wrapper (AGENTS.md §8.2). Every invoke() call must
 * go through this so native Rust errors are normalized into a structured
 * frontend error state instead of an unhandled rejection.
 */
export async function callCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<IpcResult<T>> {
  try {
    const data = await invoke<T>(command, args);
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
