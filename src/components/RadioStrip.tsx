// Radio strip (collapsible, under the top bar): presets and saved stations, name and address,
// Test, Load to A / B, Save, add to Automix, delete.

import { useEffect, useState, type ReactNode } from "react";
import { backend } from "../ipc/backend";
import type { DeckName, Preset, StationRow } from "../ipc/types";
import { notify, setQueue } from "../state/app";
import { createStore, useStore } from "../state/store";
import { confirmAction } from "./Dialog";

export const radioOpen = createStore(false);

const field = "rounded border border-border bg-bg px-2 py-1 text-[13px]";
const btn = "rounded bg-surface-raised px-2.5 py-1 text-[12px] font-semibold hover:bg-accent/30 disabled:opacity-40";

export function RadioStrip(): ReactNode {
  const open = useStore(radioOpen, (o) => o);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = (): void => {
    void backend()
      .stationsList()
      .then((r) => {
        if (r.ok) setStations(r.value);
      });
  };

  useEffect(() => {
    if (!open) return;
    void backend()
      .radioPresets()
      .then((r) => {
        if (r.ok) setPresets(r.value);
      });
    reload();
  }, [open]);

  if (!open) return null;

  const choose = (value: string): void => {
    setCheck(null);
    if (value.startsWith("s:")) {
      const st = stations.find((x) => String(x.id) === value.slice(2));
      if (st) {
        setSelected(st.id);
        setName(st.name);
        setUrl(st.url);
        setMinutes(st.playMinutes);
      }
    } else if (value.startsWith("p:")) {
      const pr = presets[Number(value.slice(2))];
      if (pr) {
        setSelected(null);
        setName(pr.name);
        setUrl(pr.url);
      }
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setCheck(null);
    const r = await backend().stationProbe(url);
    setTesting(false);
    setCheck(r.ok ? { ok: true, text: `Works: ${r.value}` } : { ok: false, text: r.error });
  };

  const load = async (deck: DeckName): Promise<void> => {
    const r =
      selected !== null && stations.find((x) => x.id === selected)?.url === url.trim()
        ? await backend().deckLoadStation(deck, selected)
        : await backend().deckLoadUrl(deck, url, name.trim() === "" ? null : name);
    if (!r.ok) notify("error", `Radio to deck ${deck}: ${r.error}`);
    else notify("info", `${r.value.title} on deck ${deck} — press PLAY`);
  };

  const save = async (): Promise<number | null> => {
    const r = await backend().stationSave(selected, name, url, minutes);
    if (!r.ok) {
      notify("error", `Save station: ${r.error}`);
      return null;
    }
    setSelected(r.value);
    notify("info", `Station “${name.trim()}” saved`);
    reload();
    return r.value;
  };

  const toAutomix = async (): Promise<void> => {
    const id = selected ?? (await save());
    if (id === null) return;
    setQueue(await backend().queueAddStation(id, null), "Add station to Automix");
    notify("info", `“${name.trim()}” added to Automix (plays ${minutes} min)`);
  };

  const remove = async (): Promise<void> => {
    if (selected === null) return;
    const yes = await confirmAction("Delete station", `Delete “${name}” from the saved stations?`, "Delete", true);
    if (!yes) return;
    const r = await backend().stationDelete(selected);
    if (!r.ok) notify("error", `Delete station: ${r.error}`);
    setSelected(null);
    reload();
  };

  const valid = /^https?:\/\//i.test(url.trim());

  return (
    <section aria-label="Radio" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
      <span className="text-[12px] font-bold tracking-wide text-accent">RADIO</span>
      <select
        aria-label="Stations and presets"
        title="Saved stations and ready-made presets"
        className={field}
        value={selected !== null ? `s:${selected}` : ""}
        onChange={(e) => {
          choose(e.target.value);
        }}
      >
        <option value="">Choose a station…</option>
        {stations.length > 0 && (
          <optgroup label="Saved stations">
            {stations.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Presets">
          {presets.map((p, i) => (
            <option key={p.url} value={`p:${i}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>
      <input
        aria-label="Station name"
        placeholder="Name"
        className={`${field} w-40`}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <input
        aria-label="Stream address"
        placeholder="Stream address (http… .mp3 / .aac / .pls / .m3u)"
        className={`${field} min-w-64 flex-1`}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setCheck(null);
        }}
      />
      <label className="flex items-center gap-1 text-[12px] text-muted" title="How long Automix plays this station before the next queue item">
        Automix plays
        <input
          type="number"
          min={1}
          max={1440}
          aria-label="Automix play minutes"
          className={`${field} w-16 text-right`}
          value={minutes}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setMinutes(Math.max(1, Math.min(1440, Math.round(v))));
          }}
        />
        min
      </label>
      <button type="button" className={btn} disabled={!valid || testing} title="Check that this address plays (nothing is heard)" onClick={() => void test()}>
        {testing ? "Testing…" : "Test"}
      </button>
      <button type="button" className={btn} disabled={!valid} title="Load this station onto deck A" onClick={() => void load("A")}>
        → A
      </button>
      <button type="button" className={btn} disabled={!valid} title="Load this station onto deck B" onClick={() => void load("B")}>
        → B
      </button>
      <button type="button" className={btn} disabled={!valid || name.trim() === ""} title="Save as a station" onClick={() => void save()}>
        Save
      </button>
      <button type="button" className={btn} disabled={!valid || name.trim() === ""} title="Add this station to the Automix queue" onClick={() => void toAutomix()}>
        + Automix
      </button>
      {selected !== null && (
        <button type="button" className={`${btn} text-danger`} title="Delete this saved station" onClick={() => void remove()}>
          Delete
        </button>
      )}
      {check && (
        <p role={check.ok ? "status" : "alert"} className={`basis-full text-[12px] ${check.ok ? "text-accent" : "text-danger"}`}>
          {check.text}
        </p>
      )}
    </section>
  );
}
