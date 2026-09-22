import { useEffect, useState } from "react";
import { getAudioContext, ensureAudioContextRunning } from "./audio";
import { openFolderDialog } from "./services/dialog";
import { initNativeFileDropListener } from "./services/dragAndDrop";
import { ContextMenu } from "./components/common/ContextMenu";
import { LowerBay } from "./components/layout/LowerBay";

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
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-textPrimary">
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 p-3">
        <h1 className="text-lg font-semibold text-accent">BongPlayer</h1>
        <button
          type="button"
          onClick={handleActivateAudio}
          className="rounded bg-surfaceRaised px-3 py-1.5 text-sm text-textPrimary hover:bg-accent/20"
        >
          Activate Audio Context ({audioState})
        </button>
        <button
          type="button"
          onClick={handleBrowseFolder}
          className="rounded bg-surfaceRaised px-3 py-1.5 text-sm text-textPrimary hover:bg-accent/20"
        >
          Browse Folder
        </button>
        {folderPath !== null && (
          <span className="truncate text-sm text-textMuted">{folderPath}</span>
        )}
      </header>

      {/* Deck/mixer/waveform rows land above this in Phase 6 — the lower bay is self-contained for now. */}
      <div className="min-h-0 flex-1">
        <LowerBay />
      </div>

      <ContextMenu />
    </main>
  );
}

export default App;
