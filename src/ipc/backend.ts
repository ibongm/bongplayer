// The UI talks to Rust only through this interface. In the desktop app it calls Tauri
// commands; in a plain browser (`npm run dev`) and in tests it uses the in-memory mock.

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  arrayOf,
  isAnalysisReport,
  isArrayBuffer,
  isOutputDevices,
  isPreset,
  isStationRow,
  isAppInfo,
  isCrateEntry,
  isCrateInfo,
  isDirListing,
  isDrive,
  isFolderEntry,
  isFolderTracks,
  isImportReport,
  isLockInfo,
  isLookupOutcome,
  isLyricsOrNull,
  isPadList,
  isNumber,
  isQueueEntry,
  isString,
  isStatusSnapshot,
  isTrackRow,
  isUnit,
  type Guard,
} from "./guards";
import type {
  AnalysisReport,
  AppInfo,
  AutomixConfig,
  LockInfo,
  LookupOutcome,
  Lyrics,
  PadInfo,
  MasterAction,
  CrateEntry,
  CrateInfo,
  CrateKind,
  DeckName,
  DirListing,
  Drive,
  FolderEntry,
  FolderTracks,
  ImportReport,
  IpcResult,
  OutputDevices,
  Preset,
  QueueEntry,
  StationRow,
  StatusSnapshot,
  TrackRow,
  UiCommand,
  Waveform,
} from "./types";

export interface Backend {
  appInfo(): Promise<IpcResult<AppInfo>>;
  engineStatus(): Promise<IpcResult<StatusSnapshot>>;
  listDrives(): Promise<IpcResult<Drive[]>>;
  specialFolders(): Promise<IpcResult<FolderEntry[]>>;
  listDir(path: string): Promise<IpcResult<DirListing>>;
  showInExplorer(path: string): Promise<IpcResult<null>>;
  folderTracks(path: string): Promise<IpcResult<FolderTracks>>;
  libraryTracks(): Promise<IpcResult<TrackRow[]>>;
  importPaths(paths: string[]): Promise<IpcResult<TrackRow[]>>;
  cratesList(): Promise<IpcResult<CrateInfo[]>>;
  crateCreate(name: string, kind: CrateKind): Promise<IpcResult<number>>;
  crateRename(id: number, name: string): Promise<IpcResult<null>>;
  crateDelete(id: number): Promise<IpcResult<null>>;
  crateTracks(id: number): Promise<IpcResult<CrateEntry[]>>;
  crateAdd(id: number, trackIds: number[]): Promise<IpcResult<number>>;
  crateAddPaths(id: number, paths: string[]): Promise<IpcResult<number>>;
  crateRemove(id: number, positions: number[]): Promise<IpcResult<number>>;
  importM3u(path: string): Promise<IpcResult<ImportReport>>;
  analyzeTracks(trackIds: number[]): Promise<IpcResult<AnalysisReport>>;
  markPlayed(trackIds: number[]): Promise<IpcResult<number>>;
  removeTracks(trackIds: number[]): Promise<IpcResult<number>>;
  setRating(trackIds: number[], rating: number): Promise<IpcResult<number>>;
  setBpm(trackIds: number[], bpm: number | null): Promise<IpcResult<number>>;
  settingGet(key: string): Promise<IpcResult<string | null>>;
  settingSet(key: string, value: string): Promise<IpcResult<null>>;
  deckLoad(deck: DeckName, trackId: number): Promise<IpcResult<TrackRow>>;
  deckLoadPath(deck: DeckName, path: string): Promise<IpcResult<TrackRow>>;
  hotCueSet(deck: DeckName, slot: number): Promise<IpcResult<null>>;
  hotCueClear(deck: DeckName, slot: number): Promise<IpcResult<null>>;
  engineCommand(command: UiCommand): Promise<IpcResult<null>>;
  deckWaveform(trackId: number): Promise<IpcResult<Waveform>>;
  outputDevices(): Promise<IpcResult<OutputDevices>>;
  setPreferredOutput(id: string | null): Promise<IpcResult<null>>;
  automixStart(): Promise<IpcResult<null>>;
  automixStop(): Promise<IpcResult<null>>;
  automixSkip(): Promise<IpcResult<null>>;
  automixConfig(config: AutomixConfig): Promise<IpcResult<null>>;
  masterTransport(action: MasterAction): Promise<IpcResult<null>>;
  lockInfo(): Promise<IpcResult<LockInfo>>;
  lockEngage(): Promise<IpcResult<null>>;
  lockRelease(pin: string | null, hold: boolean): Promise<IpcResult<null>>;
  lockConfigure(
    volumeAllowed: boolean,
    holdUnlocks: boolean,
    currentPin: string | null,
    newPin: string | null,
  ): Promise<IpcResult<null>>;
  duck(on: boolean): Promise<IpcResult<null>>;
  duckDepth(db: number): Promise<IpcResult<null>>;
  radioPresets(): Promise<IpcResult<Preset[]>>;
  stationsList(): Promise<IpcResult<StationRow[]>>;
  stationSave(id: number | null, name: string, url: string, playMinutes: number): Promise<IpcResult<number>>;
  stationDelete(id: number): Promise<IpcResult<null>>;
  stationProbe(url: string): Promise<IpcResult<string>>;
  deckLoadStation(deck: DeckName, id: number): Promise<IpcResult<TrackRow>>;
  deckLoadUrl(deck: DeckName, url: string, name: string | null): Promise<IpcResult<TrackRow>>;
  queueAddStation(id: number, before: number | null): Promise<IpcResult<QueueEntry[]>>;
  /** JPEG bytes of a track's cover; fails with "no cover" when there is none. */
  trackCover(trackId: number, large: boolean): Promise<IpcResult<ArrayBuffer>>;
  lookupTrack(trackId: number): Promise<IpcResult<LookupOutcome>>;
  /** Lyrics from the .lrc file, the file's tags, or LRCLIB (internet on); null when none. */
  trackLyrics(trackId: number): Promise<IpcResult<Lyrics | null>>;
  samplerPads(): Promise<IpcResult<PadInfo[]>>;
  samplerLoad(pad: number, path: string): Promise<IpcResult<PadInfo[]>>;
  samplerClear(pad: number): Promise<IpcResult<PadInfo[]>>;
  samplerConfigure(pad: number, gainDb: number, choke: number): Promise<IpcResult<PadInfo[]>>;
  samplerTrigger(pad: number): Promise<IpcResult<null>>;
  /** Stops one pad, or all pads when `pad` is null. */
  samplerStop(pad: number | null): Promise<IpcResult<null>>;
  queueList(): Promise<IpcResult<QueueEntry[]>>;
  queueAdd(trackIds: number[], before: number | null): Promise<IpcResult<QueueEntry[]>>;
  queueAddPaths(paths: string[], before: number | null): Promise<IpcResult<QueueEntry[]>>;
  queueMove(uids: number[], before: number | null): Promise<IpcResult<QueueEntry[]>>;
  queueRemove(uids: number[]): Promise<IpcResult<QueueEntry[]>>;
  queueClear(): Promise<IpcResult<QueueEntry[]>>;
  queueShuffle(): Promise<IpcResult<QueueEntry[]>>;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

/** Calls a Tauri command; Rust errors and unexpected shapes become `{ ok: false }`. */
export async function call<T>(
  command: string,
  args: Record<string, unknown>,
  guard: Guard<T>,
): Promise<IpcResult<T>> {
  try {
    const value: unknown = await invoke(command, args);
    if (!guard(value)) {
      return { ok: false, error: `${command} returned an unexpected shape` };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const unit = (v: unknown): v is null => isUnit(v);
const tracks = arrayOf(isTrackRow);
const queue = arrayOf(isQueueEntry);

/** Parses the binary waveform from Rust (see src-tauri/src/waveform.rs). */
export function parseWaveform(buf: ArrayBuffer): Waveform | null {
  if (buf.byteLength < 8) return null;
  const view = new DataView(buf);
  const binsPerSecond = view.getUint32(0, true) / 1000;
  const count = view.getUint32(4, true);
  if (buf.byteLength < 8 + count * 4 || binsPerSecond <= 0) return null;
  return { binsPerSecond, count, bins: new Uint8Array(buf, 8, count * 4) };
}

export const tauriBackend: Backend = {
  appInfo: () => call("app_info", {}, isAppInfo),
  engineStatus: () => call("engine_status", {}, isStatusSnapshot),
  listDrives: () => call("list_drives", {}, arrayOf(isDrive)),
  specialFolders: () => call("special_folders", {}, arrayOf(isFolderEntry)),
  listDir: (path) => call("list_dir", { path }, isDirListing),
  showInExplorer: (path) => call("show_in_explorer", { path }, unit),
  folderTracks: (path) => call("folder_tracks", { path }, isFolderTracks),
  libraryTracks: () => call("library_tracks", {}, tracks),
  importPaths: (paths) => call("import_paths", { paths }, tracks),
  cratesList: () => call("crates_list", {}, arrayOf(isCrateInfo)),
  crateCreate: (name, kind) => call("crate_create", { name, kind }, isNumber),
  crateRename: (id, name) => call("crate_rename", { id, name }, unit),
  crateDelete: (id) => call("crate_delete", { id }, unit),
  crateTracks: (id) => call("crate_tracks", { id }, arrayOf(isCrateEntry)),
  crateAdd: (id, trackIds) => call("crate_add", { id, trackIds }, isNumber),
  crateAddPaths: (id, paths) => call("crate_add_paths", { id, paths }, isNumber),
  crateRemove: (id, positions) => call("crate_remove", { id, positions }, isNumber),
  importM3u: (path) => call("import_m3u", { path }, isImportReport),
  analyzeTracks: (trackIds) => call("analyze_tracks", { trackIds }, isAnalysisReport),
  markPlayed: (trackIds) => call("mark_played", { trackIds }, isNumber),
  removeTracks: (trackIds) => call("remove_tracks", { trackIds }, isNumber),
  setRating: (trackIds, rating) => call("set_rating", { trackIds, rating }, isNumber),
  setBpm: (trackIds, bpm) => call("set_bpm", { trackIds, bpm }, isNumber),
  settingGet: (key) =>
    call("setting_get", { key }, (v: unknown): v is string | null => v === null || typeof v === "string"),
  settingSet: (key, value) => call("setting_set", { key, value }, unit),
  deckLoad: (deck, trackId) => call("deck_load", { deck, trackId }, isTrackRow),
  deckLoadPath: (deck, path) => call("deck_load_path", { deck, path }, isTrackRow),
  hotCueSet: (deck, slot) => call("hot_cue_set", { deck, slot }, unit),
  hotCueClear: (deck, slot) => call("hot_cue_clear", { deck, slot }, unit),
  engineCommand: (command) => call("engine_command", { command }, unit),
  deckWaveform: async (trackId) => {
    const r = await call("deck_waveform", { trackId }, isArrayBuffer);
    if (!r.ok) return r;
    const w = parseWaveform(r.value);
    return w ? { ok: true, value: w } : { ok: false, error: "waveform data is damaged" };
  },
  outputDevices: () => call("output_devices", {}, isOutputDevices),
  setPreferredOutput: (id) => call("set_preferred_output", { id }, unit),
  automixStart: () => call("automix_start", {}, unit),
  automixStop: () => call("automix_stop", {}, unit),
  automixSkip: () => call("automix_skip", {}, unit),
  automixConfig: (config) => call("automix_config", { config }, unit),
  masterTransport: (action) => call("master_transport", { action }, unit),
  lockInfo: () => call("lock_info", {}, isLockInfo),
  lockEngage: () => call("lock_engage", {}, unit),
  lockRelease: (pin, hold) => call("lock_release", { pin, hold }, unit),
  lockConfigure: (volumeAllowed, holdUnlocks, currentPin, newPin) =>
    call("lock_configure", { volumeAllowed, holdUnlocks, currentPin, newPin }, unit),
  duck: (on) => call("duck", { on }, unit),
  duckDepth: (db) => call("duck_depth", { db }, unit),
  radioPresets: () => call("radio_presets", {}, arrayOf(isPreset)),
  stationsList: () => call("stations_list", {}, arrayOf(isStationRow)),
  stationSave: (id, name, url, playMinutes) => call("station_save", { id, name, url, playMinutes }, isNumber),
  stationDelete: (id) => call("station_delete", { id }, unit),
  stationProbe: (url) => call("station_probe", { url }, isString),
  deckLoadStation: (deck, id) => call("deck_load_station", { deck, id }, isTrackRow),
  deckLoadUrl: (deck, url, name) => call("deck_load_url", { deck, url, name }, isTrackRow),
  queueAddStation: (id, before) => call("queue_add_station", { id, before }, queue),
  trackCover: (trackId, large) => call("track_cover", { trackId, large }, isArrayBuffer),
  lookupTrack: (trackId) => call("lookup_track", { trackId }, isLookupOutcome),
  trackLyrics: (trackId) => call("track_lyrics", { trackId }, isLyricsOrNull),
  samplerPads: () => call("sampler_pads", {}, isPadList),
  samplerLoad: (pad, path) => call("sampler_load", { pad, path }, isPadList),
  samplerClear: (pad) => call("sampler_clear", { pad }, isPadList),
  samplerConfigure: (pad, gainDb, choke) => call("sampler_configure", { pad, gainDb, choke }, isPadList),
  samplerTrigger: (pad) => call("sampler_trigger", { pad }, unit),
  samplerStop: (pad) => call("sampler_stop", { pad }, unit),
  queueList: () => call("queue_list", {}, queue),
  queueAdd: (trackIds, before) => call("queue_add", { trackIds, before }, queue),
  queueAddPaths: (paths, before) => call("queue_add_paths", { paths, before }, queue),
  queueMove: (uids, before) => call("queue_move", { uids, before }, queue),
  queueRemove: (uids) => call("queue_remove", { uids }, queue),
  queueClear: () => call("queue_clear", {}, queue),
  queueShuffle: () => call("queue_shuffle", {}, queue),
};

let current: Backend | null = null;

/** The active backend: Tauri in the desktop app, the mock in a browser. */
export function backend(): Backend {
  if (current === null) {
    throw new Error("backend not initialised: call initBackend() first");
  }
  return current;
}

/** Chooses the backend once at start-up (tests pass their own). */
export async function initBackend(override?: Backend): Promise<Backend> {
  if (override) {
    current = override;
  } else if (isTauri()) {
    current = tauriBackend;
  } else {
    const { createMockBackend } = await import("./mock");
    current = createMockBackend();
  }
  return current;
}
