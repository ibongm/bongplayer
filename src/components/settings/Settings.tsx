// ⚙ Settings window: Appearance, Audio, Library, Automix, Lock, Radio, Internet, Keyboard
// shortcuts, MIDI (DDJ-400).

import { isTauri } from "@tauri-apps/api/core";
import {
  disable as autostartOff,
  enable as autostartOn,
  isEnabled as autostartIsOn,
} from "@tauri-apps/plugin-autostart";
import { useEffect, useState, type ReactNode } from "react";
import { backend } from "../../ipc/backend";
import type { AutomixConfig, LockInfo, OutputDevices } from "../../ipc/types";
import { notify, status } from "../../state/app";
import { setAutomixConfig, STYLES } from "../AutomixCockpit";
import { AppearanceTab, LibraryTab, MidiTab, RadioTab, ShortcutsTab } from "./MoreTabs";
import { useStore } from "../../state/store";
import { internetLookup, loadInternetLookup, send, setInternetLookup, settingsOpen } from "../../state/ui";

const CEILING_KEY = "audio.limiter_ceiling";

function AudioTab(): ReactNode {
  const [devices, setDevices] = useState<OutputDevices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ceiling, setCeiling] = useState(-1);

  const load = (): void => {
    void backend()
      .outputDevices()
      .then((r) => {
        if (r.ok) {
          setDevices(r.value);
          setError(null);
        } else setError(r.error);
      });
  };

  useEffect(() => {
    load();
    void backend()
      .settingGet(CEILING_KEY)
      .then((r) => {
        if (r.ok && r.value !== null && Number.isFinite(Number(r.value))) setCeiling(Number(r.value));
      });
    const id = window.setInterval(load, 2000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const choose = async (id: string | null): Promise<void> => {
    const r = await backend().setPreferredOutput(id);
    if (!r.ok) {
      notify("error", `Output device: ${r.error}`);
      return;
    }
    notify("info", id === null ? "Output follows the Windows default device" : "Preferred output saved");
    load();
  };

  const applyCeiling = (v: number): void => {
    setCeiling(v);
    void send({ type: "limiterCeiling", db: v }, "Limiter");
    void backend().settingSet(CEILING_KEY, String(v));
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Output device</h3>
        <p className="mb-2 text-[12px] text-muted">
          At night choose the DDJ-400: music moves to it whenever it is plugged in, and falls back to the
          Windows default device if it disappears.
        </p>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        {devices && (
          <fieldset className="flex flex-col gap-1" aria-label="Preferred output device">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" name="out" checked={devices.preferred === null} onChange={() => void choose(null)} />
              Windows default device
            </label>
            {devices.devices.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="out" checked={devices.preferred === d.id} onChange={() => void choose(d.id)} />
                {d.name}
                {d.isDefault && <span className="text-[11px] text-muted">(Windows default)</span>}
                {devices.current?.id === d.id && <span className="text-[11px] text-accent">● playing</span>}
              </label>
            ))}
            {devices.preferred !== null && !devices.devices.some((d) => d.id === devices.preferred) && (
              <p className="text-[12px] text-muted">The preferred device is not plugged in; playing on the default.</p>
            )}
          </fieldset>
        )}
        {devices && (
          <p className="mt-2 text-[12px] text-muted">
            Now playing on: {devices.current?.name ?? "nothing"} at {devices.sampleRate} Hz
          </p>
        )}
      </section>
      <DuckDepth />
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Limiter ceiling</h3>
        <p className="mb-2 text-[12px] text-muted">The master output never goes above this level.</p>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="range"
            min={-12}
            max={0}
            step={0.1}
            value={ceiling}
            aria-label="Limiter ceiling"
            onChange={(e) => {
              applyCeiling(Number(e.target.value));
            }}
          />
          <span className="tabular-nums">{ceiling.toFixed(1)} dBFS</span>
        </label>
      </section>
    </div>
  );
}

function DuckDepth(): ReactNode {
  const [depth, setDepth] = useState(12);
  useEffect(() => {
    void backend()
      .settingGet("duck.depth_db")
      .then((r) => {
        if (r.ok && r.value !== null && Number.isFinite(Number(r.value))) setDepth(Number(r.value));
      });
  }, []);
  return (
    <section>
      <h3 className="mb-1 text-[13px] font-semibold">DUCK depth</h3>
      <p className="mb-2 text-[12px] text-muted">How much DUCK lowers the music for an announcement.</p>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="range"
          min={3}
          max={30}
          step={1}
          value={depth}
          aria-label="DUCK depth"
          onChange={(e) => {
            const v = Number(e.target.value);
            setDepth(v);
            void backend().duckDepth(v);
          }}
        />
        <span className="tabular-nums">−{depth} dB</span>
      </label>
    </section>
  );
}

function AutomixTab(): ReactNode {
  const cfgJson = useStore(status, (st) => (st ? JSON.stringify(st.automix.config) : ""));
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    autostartIsOn().then(setAutostart, () => {
      setAutostart(null);
    });
  }, []);
  if (cfgJson === "") return <p className="text-[13px] text-muted">Waiting for the audio engine…</p>;
  const cfg = JSON.parse(cfgJson) as AutomixConfig;
  const row = (label: string, control: ReactNode, help: string): ReactNode => (
    <label className="grid grid-cols-[160px_1fr] items-center gap-2 text-[13px]" title={help}>
      <span>{label}</span>
      {control}
    </label>
  );
  const num = (key: "triggerSeconds" | "crossfadeSeconds", min: number, max: number): ReactNode => (
    <input
      type="number"
      min={min}
      max={max}
      step={0.5}
      value={cfg[key]}
      aria-label={key === "triggerSeconds" ? "Trigger seconds" : "Crossfade seconds"}
      className="w-24 rounded border border-border bg-bg px-2 py-1"
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) setAutomixConfig({ [key]: Math.max(min, Math.min(max, v)) });
      }}
    />
  );
  const check = (key: "loopQueue" | "shuffle" | "autoRemove", label: string): ReactNode => (
    <input
      type="checkbox"
      checked={cfg[key]}
      aria-label={label}
      onChange={(e) => {
        setAutomixConfig({ [key]: e.target.checked });
      }}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">These settings are saved and used every time Automix runs.</p>
      {row("Trigger (seconds left)", num("triggerSeconds", 1, 60), "Start the transition when the playing track has this many seconds left")}
      {row("Crossfade (seconds)", num("crossfadeSeconds", 0, 30), "Length of the transition")}
      {row(
        "Transition",
        <select
          aria-label="Default transition"
          value={cfg.style}
          className="w-56 rounded border border-border bg-bg px-2 py-1"
          onChange={(e) => {
            const style = STYLES.find((x) => x.id === e.target.value)?.id;
            if (style) setAutomixConfig({ style });
          }}
        >
          {STYLES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label} — {x.help}
            </option>
          ))}
        </select>,
        "How one track blends into the next",
      )}
      {row("Loop the queue", check("loopQueue", "Loop the queue"), "At the end of the queue, start again from the top")}
      {row("Shuffle", check("shuffle", "Shuffle"), "Random order, each track once per round")}
      {row("Auto-remove played", check("autoRemove", "Auto-remove played"), "Remove tracks from the queue once played")}
      <section className="border-t border-border pt-3">
        <h3 className="mb-1 text-[13px] font-semibold">Start with Windows</h3>
        {isTauri() ? (
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={autostart === true}
              disabled={autostart === null}
              aria-label="Start BongPlayer when Windows starts"
              onChange={(e) => {
                const on = e.target.checked;
                (on ? autostartOn() : autostartOff()).then(
                  () => {
                    setAutostart(on);
                  },
                  (err: unknown) => {
                    notify("error", "Start with Windows: " + String(err));
                  },
                );
              }}
            />
            Start BongPlayer when Windows starts (Automix then continues where it stopped)
          </label>
        ) : (
          <p className="text-[12px] text-muted">Available in the desktop app.</p>
        )}
      </section>
    </div>
  );
}

function LockTab(): ReactNode {
  const [info, setInfo] = useState<LockInfo | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const reload = (): void => {
    void backend()
      .lockInfo()
      .then((r) => {
        if (r.ok) setInfo(r.value);
      });
  };
  useEffect(reload, []);
  if (!info) return <p className="text-[13px] text-muted">Loading…</p>;
  const save = (volumeAllowed: boolean, holdUnlocks: boolean, newPin: string | null): void => {
    void backend()
      .lockConfigure(volumeAllowed, holdUnlocks, current === "" ? null : current, newPin)
      .then((r) => {
        if (!r.ok) notify("error", "Lock settings: " + r.error);
        else {
          notify("info", "Lock settings saved");
          setCurrent("");
          setNext("");
        }
        reload();
      });
  };
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-[12px] text-muted">
        LOCK stops play / skip / load / crossfader / queue changes so staff cannot change the music by accident.
      </p>
      {info.locked && (
        <p role="alert" className="text-danger">
          Unlock first to change these settings.
        </p>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={info.volumeAllowed}
          disabled={info.locked}
          onChange={(e) => {
            save(e.target.checked, info.holdUnlocks, null);
          }}
        />
        Volume and DUCK still work while locked
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={info.holdUnlocks}
          disabled={info.locked}
          onChange={(e) => {
            save(info.volumeAllowed, e.target.checked, null);
          }}
        />
        Holding the LOCK button for 2 seconds unlocks (without the PIN)
      </label>
      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="font-semibold">PIN {info.hasPin ? "(set)" : "(none)"}</h3>
        {info.hasPin && (
          <input
            type="password"
            inputMode="numeric"
            placeholder="Current PIN"
            aria-label="Current PIN"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
            }}
            className="w-40 rounded border border-border bg-bg px-2 py-1"
          />
        )}
        <input
          type="password"
          inputMode="numeric"
          placeholder="New PIN (4+ digits)"
          aria-label="New PIN"
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
          }}
          className="w-40 rounded border border-border bg-bg px-2 py-1"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={info.locked || next === ""}
            className="rounded bg-accent px-3 py-1 font-semibold text-bg disabled:opacity-40"
            onClick={() => {
              save(info.volumeAllowed, info.holdUnlocks, next);
            }}
          >
            {info.hasPin ? "Change PIN" : "Set PIN"}
          </button>
          {info.hasPin && (
            <button
              type="button"
              disabled={info.locked}
              className="rounded bg-surface-raised px-3 py-1 disabled:opacity-40"
              onClick={() => {
                save(info.volumeAllowed, info.holdUnlocks, "");
              }}
            >
              Remove PIN
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function InternetTab(): ReactNode {
  const on = useStore(internetLookup, (v) => v);
  useEffect(() => {
    void loadInternetLookup();
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Internet lookup</h3>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={on === true}
            disabled={on === null}
            onChange={(e) => {
              const next = e.target.checked;
              void setInternetLookup(next).then((ok) => {
                if (!ok) notify("error", "Could not save the internet lookup setting");
              });
            }}
          />
          Look up missing covers, album, year, genre and lyrics online
        </label>
        <p className="mt-2 text-[12px] text-muted">
          Off by default. Covers are always taken from the file or its folder (folder.jpg) first — that
          needs no internet.
        </p>
        <p className="mt-2 text-[12px] text-muted">
          When on, the <strong>artist and title</strong> of a track (never the file name or folder) are sent
          to MusicBrainz and Cover Art Archive, and if they have no clean match, to Apple iTunes Search and
          Deezer. Each track is looked up once, the first time it is loaded on a deck or when you press
          “Look up online” in the Info tab. Only empty fields are filled.
        </p>
        <p className="mt-2 text-[12px] text-muted">
          Lyrics: a .lrc file beside the song or lyrics in its tags are used first. Otherwise, when on, the
          artist and title go to LRCLIB (lrclib.net) once per track, when KARAOKE or the LRC drawer shows it.
        </p>
      </section>
    </div>
  );
}

type TabId = string;
const TABS: { id: TabId; label: string; panel: () => ReactNode }[] = [
  { id: "appearance", label: "Appearance", panel: () => <AppearanceTab /> },
  { id: "audio", label: "Audio", panel: () => <AudioTab /> },
  { id: "library", label: "Library", panel: () => <LibraryTab /> },
  { id: "automix", label: "Automix", panel: () => <AutomixTab /> },
  { id: "lock", label: "Lock", panel: () => <LockTab /> },
  { id: "radio", label: "Radio", panel: () => <RadioTab /> },
  { id: "internet", label: "Internet", panel: () => <InternetTab /> },
  { id: "shortcuts", label: "Keyboard shortcuts", panel: () => <ShortcutsTab /> },
  { id: "midi", label: "MIDI", panel: () => <MidiTab /> },
];

export function SettingsDialog(): ReactNode {
  const open = useStore(settingsOpen, (o) => o);
  const [tab, setTab] = useState<TabId>("audio");
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") settingsOpen.set(false);
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Settings" className="flex h-[70vh] w-[720px] max-w-[95vw] flex-col rounded-lg border border-border bg-surface shadow-2xl">
        <header className="flex items-center border-b border-border px-4 py-2">
          <h2 className="flex-1 text-[15px] font-semibold">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            title="Close (Esc)"
            className="rounded px-2 text-muted hover:text-text"
            onClick={() => {
              settingsOpen.set(false);
            }}
          >
            ✕
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="flex w-40 flex-col gap-1 border-r border-border p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`rounded px-2 py-1 text-left text-[13px] ${tab === t.id ? "bg-accent/25" : "hover:bg-surface-raised"}`}
                onClick={() => {
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-w-0 flex-1 overflow-y-auto p-4">
            {TABS.find((t) => t.id === tab)?.panel()}
          </div>
        </div>
      </div>
    </div>
  );
}
