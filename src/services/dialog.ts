import { open } from "@tauri-apps/plugin-dialog";

/**
 * Opens the native folder picker (backed by the `dialog:default` capability
 * in src-tauri/capabilities/default.json). Returns null if the user cancels.
 */
export async function openFolderDialog(): Promise<string | null> {
  try {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to open folder dialog: ${message}`, { cause: error });
  }
}
