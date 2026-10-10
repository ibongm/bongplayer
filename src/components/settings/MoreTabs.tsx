// Settings tabs added in M10: Appearance (skins), Library, Radio, Keyboard shortcuts.

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";
import { backend } from "../../ipc/backend";
import type { LibraryInfo, StationRow } from "../../ipc/types";
import { notify } from "../../state/app";
import { chooseSkin, COLOR_NAMES, deleteSkin, importSkin, SKINS, skins } from "../../state/skins";
import { useStore } from "../../state/store";
import { confirmAction } from "../Dialog";
import { radioOpen } from "../RadioStrip";
import { SHORTCUTS } from "../TopBar";
import { COLUMNS, tableColumns, toggleColumn } from "../TrackTable";
import { settingsOpen } from "../../state/ui";

const btn = "rounded bg-surface-raised px-2.5 py-1 text-[12px] font-semibold hover:bg-accent/30 disabled:opacity-40";

/** Picks a skin file (desktop app) and imports it. */
async function importSkinFile(): Promise<void> {
  if (!isTauri()) {
    notify("error", "Importing a skin file needs the desktop app");
    return;
  }
  const file = await openFileDialog({
    multiple: false,
    title: "Import a skin",
    filters: [{ name: "Skin (JSON)", extensions: ["json"] }],
  });
  if (typeof file !== "string") return;
  const r = await backend().skinFileRead(file);
  if (!r.ok) {
    notify("error", `Skin file: ${r.error}`);
    return;
  }
  await importSkin(r.value);
}

export function AppearanceTab(): ReactNode {
  const state = useStore(skins, (s) => s);
  const choices = [
    ...SKINS.map((s) => ({ id: s.id, name: s.name, note: s.note, custom: false })),
    ...state.custom.map((c) => ({ id: `custom:${c.name}`, name: c.name, note: `Imported, based on ${c.base}`, custom: true })),
  ];
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Skin</h3>
        <p className="mb-2 text-[12px] text-muted">Changes every colour at once, including the waveforms; it is remembered.</p>
        <fieldset className="flex flex-col gap-1" aria-label="Skin">
          {choices.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="skin"
                  checked={state.current === c.id}
                  onChange={() => void chooseSkin(c.id)}
                />
                {c.name}
                <span className="text-[11px] text-muted">{c.note}</span>
              </label>
              {c.custom && (
                <button
                  type="button"
                  className="rounded px-2 text-[12px] text-muted hover:text-danger"
                  aria-label={`Delete skin ${c.name}`}
                  title={`Delete the imported skin “${c.name}”`}
                  onClick={() => void deleteSkin(c.name)}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </fieldset>
      </section>
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Import a skin</h3>
        <p className="mb-2 text-[12px] text-muted">
          A skin file is a small .json file that changes some colours of a built-in skin:
        </p>
        <pre className="mb-2 overflow-x-auto rounded border border-border bg-bg p-2 text-[11px]">
          {`{
  "name": "Bar Red",
  "base": "pioneer-stealth",
  "colors": { "accent": "#e11d48", "focus": "#e11d48" }
}`}
        </pre>
        <p className="mb-2 text-[11px] text-muted">
          Colour names: {COLOR_NAMES.join(", ")}. Values: #rgb, #rrggbb, rgb(…) or hsl(…).
        </p>
        <button type="button" className={btn} onClick={() => void importSkinFile()}>
          Import skin file…
        </button>
      </section>
    </div>
  );
}

export function LibraryTab(): ReactNode {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columns = useStore(tableColumns, (c) => c);

  useEffect(() => {
    void backend()
      .libraryInfo()
      .then((r) => {
        if (r.ok) setInfo(r.value);
        else setError(r.error);
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Music Library</h3>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        {info && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted">Tracks</dt>
            <dd data-testid="library-tracks">{info.tracks}</dd>
            <dt className="text-muted">Stored in</dt>
            <dd className="truncate" title={info.database}>
              {info.database}
            </dd>
          </dl>
        )}
        <p className="mt-2 text-[12px] text-muted">
          Folders are read when you open them; tags and analysis are kept here so files are not read
          again.
        </p>
      </section>
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Columns in the track table</h3>
        <p className="mb-2 text-[12px] text-muted">Also: right-click the table header.</p>
        <fieldset className="grid grid-cols-3 gap-1" aria-label="Table columns">
          {COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={columns.includes(c.id)}
                disabled={columns.length === 1 && columns.includes(c.id)}
                onChange={() => {
                  toggleColumn(c.id);
                }}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
      </section>
    </div>
  );
}

export function RadioTab(): ReactNode {
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = (): void => {
    void backend()
      .stationsList()
      .then((r) => {
        if (r.ok) setStations(r.value);
        else setError(r.error);
      });
  };
  useEffect(reload, []);

  const remove = async (s: StationRow): Promise<void> => {
    if (!(await confirmAction("Delete station", `Delete the saved station “${s.name}”?`, "Delete", true))) return;
    const r = await backend().stationDelete(s.id);
    if (!r.ok) notify("error", `Delete station: ${r.error}`);
    reload();
  };

  return (
    <div className="flex flex-col gap-3">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Saved stations</h3>
        <p className="mb-2 text-[12px] text-muted">
          Add, test and load stations in the Radio strip.{" "}
          <button
            type="button"
            className="underline hover:text-text"
            onClick={() => {
              settingsOpen.set(false);
              radioOpen.set(true);
            }}
          >
            Open the Radio strip (Ctrl+R)
          </button>
        </p>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        {stations?.length === 0 && <p className="text-[12px] text-muted">No saved stations yet.</p>}
        <ul className="flex flex-col gap-1" aria-label="Saved stations">
          {stations?.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1 text-[13px]">
              <span className="font-semibold">{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted" title={s.url}>
                {s.url}
              </span>
              <span className="text-[12px] text-muted" title="How long Automix plays this station">
                {s.playMinutes} min
              </span>
              <button
                type="button"
                className="rounded px-2 text-[12px] text-muted hover:text-danger"
                aria-label={`Delete station ${s.name}`}
                onClick={() => void remove(s)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-muted">
          If a station drops out, it reconnects by itself (after 1, 2, 4, 8, then every 10 seconds).
        </p>
      </section>
    </div>
  );
}

export function ShortcutsTab(): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-muted">Keys that work anywhere in the window. Every button also shows its key in its tooltip.</p>
      <table className="w-full text-[13px]" aria-label="Keyboard shortcuts">
        <tbody>
          {SHORTCUTS.map(([key, what]) => (
            <tr key={key} className="border-b border-border/60">
              <td className="py-1 pr-4 font-mono text-[12px] whitespace-nowrap">{key}</td>
              <td className="py-1">{what}</td>
            </tr>
          ))}
          {[
            ["Table: ↑ / ↓, Shift", "Move, extend the selection"],
            ["Table: Ctrl+A / Esc", "Select all / none"],
            ["Table: Q / Del", "Add to Automix / remove"],
            ["Table: Shift+F10", "Right-click menu"],
            ["Menus: → / ←, Esc", "Open / close submenus, close"],
            ["Knobs and faders: ↑ / ↓, right-click", "Adjust, reset to default"],
          ].map(([key, what]) => (
            <tr key={key} className="border-b border-border/60">
              <td className="py-1 pr-4 font-mono text-[12px] whitespace-nowrap">{key}</td>
              <td className="py-1">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
