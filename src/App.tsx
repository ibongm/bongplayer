import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import { ContextMenuHost } from "./components/ContextMenu";
import { DayView } from "./components/DayView";
import { DialogHost } from "./components/Dialog";
import { toggleDuck, unlockWithPin } from "./components/LockDuck";
import { RadioStrip, radioOpen } from "./components/RadioStrip";
import { Dock } from "./components/Dock";
import { Deck } from "./components/deck/Deck";
import { DeckStrip } from "./components/deck/DeckStrip";
import { Mixer } from "./components/mixer/Mixer";
import { Notices } from "./components/Notices";
import { SettingsDialog } from "./components/settings/Settings";
import { TopBar } from "./components/TopBar";
import { TopWaveforms } from "./components/TopWaveforms";
import { DragLayer } from "./dnd/DragLayer";
import { backend } from "./ipc/backend";
import type { AppInfo, DeckName, IpcResult } from "./ipc/types";
import { openSource, run, status } from "./state/app";
import { useStore } from "./state/store";
import { dockTab, send, settingsOpen, view } from "./state/ui";
import { lyricsDrawer } from "./state/lyrics";
import { LyricsDrawer } from "./components/Lyrics";
import { SamplerStrip } from "./components/SamplerStrip";
import { samplerOpen, triggerPad } from "./state/sampler";
import { loadSkin } from "./state/skins";
import { Titlebar } from "./Titlebar";

interface AppProps {
  appInfo: Promise<IpcResult<AppInfo>>;
}

function StartupError({ appInfo }: AppProps): ReactNode {
  const info = use(appInfo);
  if (info.ok) return null;
  return <ErrorBanner message={`Could not read app info from Rust: ${info.error}`} />;
}

function ErrorBanner({ message }: { message: string }): ReactNode {
  return (
    <div role="alert" className="bg-danger px-3 py-1.5 text-[12px] text-danger-text">
      {message}
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

const DECK_KEYS: Record<string, { deck: DeckName; action: "play" | "cue" | "cup" | "sync" }> = {
  F1: { deck: "A", action: "play" },
  F2: { deck: "A", action: "cue" },
  F3: { deck: "A", action: "cup" },
  F4: { deck: "A", action: "sync" },
  F5: { deck: "B", action: "play" },
  F6: { deck: "B", action: "cue" },
  F7: { deck: "B", action: "cup" },
  F8: { deck: "B", action: "sync" },
};

/** Keyboard shortcuts that work anywhere in the window (see TopBar SHORTCUTS). */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      const deckKey = DECK_KEYS[e.key];
      if (deckKey) {
        e.preventDefault();
        if (e.repeat) return;
        const { deck, action } = deckKey;
        if (action === "play") void send({ type: "togglePlay", deck }, `Deck ${deck}`);
        else if (action === "cue") void send({ type: "cuePress", deck });
        else if (action === "cup") void send({ type: "cuePlay", deck });
        else void send({ type: "sync", deck }, "SYNC");
        return;
      }
      if (ctrl && (e.key === "f" || e.key === "F")) {
        const search = document.querySelector<HTMLInputElement>('[data-shortcut="ctrl+f"]');
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }
      if (ctrl && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void openSource({ kind: "library" });
        return;
      }
      // Headphone cue: Ctrl+Shift+1 / 2.
      const cueKey = /^Digit([12])$/.exec(e.code);
      if (cueKey && ctrl && e.shiftKey) {
        e.preventDefault();
        const deck: DeckName = cueKey[1] === "1" ? "A" : "B";
        const on = status.get()?.cue[deck === "A" ? 0 : 1] ?? false;
        void send({ type: "cue", deck, on: !on }, "Headphones");
        return;
      }
      if (ctrl && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        view.set(e.key === "1" ? "standard" : e.key === "2" ? "decks" : e.key === "3" ? "library" : "day");
        return;
      }
      if (ctrl && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (status.get()?.locked) void unlockWithPin();
        else void backend().lockEngage();
        return;
      }
      if ((e.key === "d" || e.key === "D") && !ctrl && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        if (!e.repeat) toggleDuck();
        return;
      }
      if (ctrl && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        radioOpen.set(!radioOpen.get());
        return;
      }
      if (ctrl && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        samplerOpen.set(!samplerOpen.get());
        return;
      }
      // Sampler pads: Alt+1…8.
      const padKey = /^Digit([1-8])$/.exec(e.code);
      if (padKey && e.altKey && !ctrl) {
        e.preventDefault();
        if (!e.repeat) void triggerPad(Number(padKey[1]) - 1);
        return;
      }
      if (ctrl && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        lyricsDrawer.set(!lyricsDrawer.get());
        return;
      }
      if (ctrl && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        dockTab.set(dockTab.get() === "info" ? "automix" : "info");
        return;
      }
      if (ctrl && e.key === ",") {
        e.preventDefault();
        settingsOpen.set(true);
        return;
      }
      // Hot cues: 1–8 deck A, Shift+1–8 deck B (not while typing or in a list).
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit && !ctrl && !e.altKey && !isTyping(e.target)) {
        const slot = Number(digit[1]) - 1;
        const deck: DeckName = e.shiftKey ? "B" : "A";
        const d = status.get()?.decks[deck === "A" ? 0 : 1];
        if (!d?.loaded) return;
        e.preventDefault();
        if (d.cues[slot] == null) void backend().hotCueSet(deck, slot).then((r) => run(r, `Hot cue ${slot + 1}`));
        else void send({ type: "jumpHotCue", deck, slot }, `Hot cue ${slot + 1}`);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === "F2") void send({ type: "cueRelease", deck: "A" });
      else if (e.key === "F6") void send({ type: "cueRelease", deck: "B" });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}

function MainArea(): ReactNode {
  const current = useStore(view, (v) => v);
  if (current === "day") return <DayView />;
  if (current === "library") {
    return (
      <>
        <div className="flex shrink-0 gap-2 p-2">
          <DeckStrip deck="A" />
          <DeckStrip deck="B" />
        </div>
        <Dock />
      </>
    );
  }
  const large = current === "decks";
  return (
    <>
      <TopWaveforms />
      <div className={`flex min-h-0 gap-2 p-2 ${large ? "flex-1" : "shrink-0"}`}>
        <Deck deck="A" large={large} />
        <Mixer />
        <Deck deck="B" large={large} />
      </div>
      {!large && <Dock />}
    </>
  );
}

export function App({ appInfo }: AppProps): ReactNode {
  const [error, setError] = useState<string | null>(null);
  useGlobalShortcuts();
  useEffect(() => {
    void loadSkin();
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <Suspense fallback={<div className="h-10 shrink-0 border-b border-border bg-surface" />}>
        <Titlebar appInfo={appInfo} onError={setError}>
          <TopBar />
        </Titlebar>
        <StartupError appInfo={appInfo} />
      </Suspense>
      {error !== null && <ErrorBanner message={error} />}
      <SamplerStrip />
      <RadioStrip />
      <main className="flex min-h-0 w-full flex-1 flex-col">
        <MainArea />
      </main>
      <LyricsDrawer />
      <SettingsDialog />
      <ContextMenuHost />
      <DialogHost />
      <DragLayer />
      <Notices />
    </div>
  );
}
