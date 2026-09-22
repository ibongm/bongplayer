import { useEffect, useState } from "react";
import { getAudioContext, ensureAudioContextRunning } from "./audio";
import { openFolderDialog } from "./services/dialog";
import { initNativeFileDropListener } from "./services/dragAndDrop";
import { initMidiHotPlug } from "./services/midiAccess";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ContextMenu } from "./components/common/ContextMenu";
import { LowerBay } from "./components/layout/LowerBay";
import { DeckMixerRow } from "./components/layout/DeckMixerRow";
import { ScrollingWaveforms } from "./components/waveforms/ScrollingWaveforms";

function App() {
  const [audioState, setAudioState] = useState<AudioContextState>("suspended");
  const [folderPath, setFolderPath] = useState<string | null>(null);

  useKeyboardShortcuts();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void initNativeFileDropListener().then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void initMidiHotPlug().then((fn) => {
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

      <div className="h-32 shrink-0 border-b border-white/10">
        <ScrollingWaveforms />
      </div>

      <div className="h-[420px] shrink-0 border-b border-white/10">
        <DeckMixerRow />
      </div>

      <div className="min-h-0 flex-1">
        <LowerBay />
      </div>

      <ContextMenu />
    </main>
  );
}

export default App;
