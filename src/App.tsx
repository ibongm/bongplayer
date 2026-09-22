import { useEffect, useState } from "react";
import { getAudioContext, ensureAudioContextRunning } from "./audio";
import { openFolderDialog } from "./services/dialog";
import { initNativeFileDropListener } from "./services/dragAndDrop";
import { initMidiHotPlug } from "./services/midiAccess";
import { initAutomixController } from "./audio/automixController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUIStore, type ThemeId } from "./store/useUIStore";
import { THEMES, applyTheme } from "./theme/themes";
import { ContextMenu } from "./components/common/ContextMenu";
import { LowerBay } from "./components/layout/LowerBay";
import { DeckMixerRow } from "./components/layout/DeckMixerRow";
import { ScrollingWaveforms } from "./components/waveforms/ScrollingWaveforms";
import { RadioPanel } from "./components/radio/RadioPanel";
import { KaraokeStage } from "./components/karaoke/KaraokeStage";

function App() {
  const [audioState, setAudioState] = useState<AudioContextState>("suspended");
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  useKeyboardShortcuts();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  useEffect(() => {
    return initAutomixController();
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
        <RadioPanel />
        <button
          type="button"
          onClick={() => setKaraokeOpen(true)}
          className="rounded bg-surfaceRaised px-3 py-1.5 text-sm text-textPrimary hover:bg-accent/20"
        >
          Karaoke
        </button>
        <select
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemeId)}
          aria-label="Theme"
          className="ml-auto rounded bg-surfaceRaised px-2 py-1.5 text-sm text-textPrimary"
        >
          {THEMES.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.label}
            </option>
          ))}
        </select>
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
      {karaokeOpen && <KaraokeStage onClose={() => setKaraokeOpen(false)} />}
    </main>
  );
}

export default App;
