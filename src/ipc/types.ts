// Payloads exchanged with the Rust side. Field names match the Rust structs (camelCase).

export interface AppInfo {
  name: string;
  version: string;
}

export interface TrackRow {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  remix: string;
  genre: string;
  year: number | null;
  durationMs: number | null;
  bpm: number | null;
  key: string | null;
  bpmIsManual: boolean;
  rating: number;
  playCount: number;
  lastPlayed: number | null;
  firstSeen: number;
  hasCover: boolean;
  analyzed: boolean;
  missing: boolean;
}

export type DriveKind = "fixed" | "removable" | "network" | "optical" | "other";

export interface Drive {
  path: string;
  label: string;
  kind: DriveKind;
}

export interface FolderEntry {
  path: string;
  name: string;
}

export interface DirListing {
  folders: FolderEntry[];
  audioFiles: string[];
  playlists: string[];
}

export interface ScanStats {
  cached: number;
  read: number;
}

export interface FolderTracks {
  rows: TrackRow[];
  stats: ScanStats;
}

export type CrateKind = "crate" | "playlist";

export interface CrateInfo {
  id: number;
  name: string;
  kind: CrateKind;
  trackCount: number;
}

export interface CrateEntry {
  position: number;
  track: TrackRow;
}

export interface ImportReport {
  crateId: number;
  name: string;
  added: number;
  missing: string[];
}

export interface AnalysisReport {
  analyzed: number;
  failed: [number, string][];
  seconds: number;
}

export interface QueueEntry {
  uid: number;
  track: TrackRow;
}

export type DeckName = "A" | "B";
export type BandName = "low" | "mid" | "high";

/** Commands sent straight to the engine (see `UiCommand` in src-tauri/src/commands.rs). */
export type UiCommand =
  | { type: "play"; deck: DeckName }
  | { type: "pause"; deck: DeckName }
  | { type: "togglePlay"; deck: DeckName }
  | { type: "seek"; deck: DeckName; seconds: number }
  | { type: "jumpHotCue"; deck: DeckName; slot: number }
  | { type: "pitch"; deck: DeckName; pitch: number }
  | { type: "pitchRange"; deck: DeckName; range: number }
  | { type: "bend"; deck: DeckName; bend: number }
  | { type: "keyLock"; deck: DeckName; on: boolean }
  | { type: "scratchStart"; deck: DeckName }
  | { type: "scratchMove"; deck: DeckName; seconds: number }
  | { type: "scratchEnd"; deck: DeckName }
  | { type: "trim"; deck: DeckName; db: number }
  | { type: "eq"; deck: DeckName; band: BandName; db: number }
  | { type: "kill"; deck: DeckName; band: BandName; on: boolean }
  | { type: "fader"; deck: DeckName; position: number }
  | { type: "crossfader"; position: number }
  | { type: "master"; db: number }
  | { type: "limiterCeiling"; db: number };

export interface DeckSnapshot {
  loaded: boolean;
  trackId: number | null;
  title: string;
  artist: string;
  path: string | null;
  position: number;
  duration: number | null;
  playing: boolean;
  ended: boolean;
  tempo: number;
  pitch: number;
  pitchRange: number;
  keyLock: boolean;
  scratching: boolean;
  trackBpm: number | null;
  bpm: number | null;
  key: string | null;
  decoded: number;
  decodeError: string | null;
  cues: (number | null)[];
}

export interface OutputSnapshot {
  running: boolean;
  device: string | null;
  reopens: number;
  problem: string | null;
}

export interface StatusSnapshot {
  decks: [DeckSnapshot, DeckSnapshot];
  sampleRate: number;
  output: OutputSnapshot;
}

/** Every IPC call resolves to this; it never rejects, so the UI always gets a visible state. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
