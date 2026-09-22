import { useEffect, useState } from "react";
import { getAudioContext, ensureAudioContextRunning } from "./audio";
import { openFolderDialog } from "./services/dialog";
import { initNativeFileDropListener } from "./services/dragAndDrop";
import { ContextMenu } from "./components/common/ContextMenu";

function App() {
  const [audioState, setAudioState] = useState<AudioContextState>("suspended");
  const [folderPath, setFolderPath] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void initNativeFileDropListener().then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  async function handleActivateAudio() {
    const ctx = getAudioContext();
    await ensureAudioContextRunning(ctx);
    setAudioState(ctx.state);
  }

  async function handleBrowseFolder() {
    const selected = await openFolderDialog();
    setFolderPath(selected);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface text-textPrimary">
      <h1 className="text-2xl font-semibold text-accent">BongPlayer</h1>
      <p className="text-textMuted">Phase 1 scaffold — Tauri v2 + React 19 + Web Audio</p>

      <div className="flex gap-4">
        <button
          type="button"
          onClick={handleActivateAudio}
          className="rounded bg-surfaceRaised px-4 py-2 text-textPrimary hover:bg-accent/20"
        >
          Activate Audio Context ({audioState})
        </button>
        <button
          type="button"
          onClick={handleBrowseFolder}
          className="rounded bg-surfaceRaised px-4 py-2 text-textPrimary hover:bg-accent/20"
        >
          Browse Folder
        </button>
      </div>

      {folderPath !== null && <p className="text-textMuted">Selected: {folderPath}</p>}
      <ContextMenu />
    </main>
  );
}

export default App;
