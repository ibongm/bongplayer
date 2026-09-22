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

const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"];

/** Opens the native single-audio-file picker (e.g. loading a sampler slot). Returns null if the user cancels. */
export async function openAudioFileDialog(): Promise<string | null> {
  try {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    return typeof selected === "string" ? selected : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to open audio file dialog: ${message}`, { cause: error });
  }
}
