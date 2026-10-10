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
  | { type: "filter"; deck: DeckName; value: number }
  | { type: "cuePress"; deck: DeckName }
  | { type: "cueRelease"; deck: DeckName }
  | { type: "cuePlay"; deck: DeckName }
  | { type: "keyShift"; deck: DeckName; semitones: number }
  | { type: "loopIn"; deck: DeckName }
  | { type: "loopOut"; deck: DeckName }
  | { type: "autoLoop"; deck: DeckName; beats: number }
  | { type: "loopResize"; deck: DeckName; factor: number }
  | { type: "loopExit"; deck: DeckName }
  | { type: "loopReenter"; deck: DeckName }
  | { type: "sync"; deck: DeckName }
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
  mainCue: number;
  keyShift: number;
  loopIn: number | null;
  loopOut: number | null;
  loopActive: boolean;
  waveform: "none" | "computing" | "ready" | "failed";
  /** [peak, rms] after the channel strip, linear. */
  meter: [number, number];
  /** A radio station is loaded (no length, seek, loops or cues). */
  live: boolean;
  /** "connecting", "playing", "reconnecting in 2 s (…)", "error: …" for radio. */
  radioState: string | null;
}

export interface LookupOutcome {
  fetched: boolean;
  filled: string[];
  cover: boolean;
  source: string | null;
}

export interface LibraryInfo {
  /** Where the library database is stored. */
  database: string;
  tracks: number;
}

export interface PadInfo {
  index: number;
  /** File name without extension ("" when empty). */
  name: string;
  path: string | null;
  gainDb: number;
  /** 0 = none, 1–4. */
  choke: number;
  seconds: number | null;
  /** Why the saved sound could not be loaded. */
  error: string | null;
}

export interface LyricLine {
  /** Start in milliseconds (0 for unsynced lyrics). */
  ms: number;
  text: string;
}

export type LyricsSource = "file" | "embedded" | "lrclib";

export interface Lyrics {
  lines: LyricLine[];
  /** Lines carry times, so the current one can be highlighted. */
  synced: boolean;
  source: LyricsSource;
  instrumental: boolean;
}

export interface StationRow {
  id: number;
  name: string;
  url: string;
  playMinutes: number;
}

export interface Preset {
  name: string;
  url: string;
}

export interface OutputSnapshot {
  running: boolean;
  device: string | null;
  reopens: number;
  problem: string | null;
}

export type TransitionStyle = "smooth" | "bassSwap" | "cut" | "echoOut";

export interface AutomixConfig {
  triggerSeconds: number;
  crossfadeSeconds: number;
  style: TransitionStyle;
  loopQueue: boolean;
  shuffle: boolean;
  autoRemove: boolean;
}

export interface AutomixSnapshot {
  on: boolean;
  currentUid: number | null;
  nextUid: number | null;
  transitioning: boolean;
  config: AutomixConfig;
  message: string | null;
}

export interface StatusSnapshot {
  decks: [DeckSnapshot, DeckSnapshot];
  sampleRate: number;
  output: OutputSnapshot;
  /** Master output [peak, rms], linear. */
  master: [number, number];
  crossfader: number;
  automix: AutomixSnapshot;
  locked: boolean;
  duckOn: boolean;
  duckDb: number;
  /** Bit i set = sampler pad i is playing. */
  padsPlaying: number;
  /** Current sampler ducking of the music in dB (0 = none). */
  samplerDuckDb: number;
}

export interface LockInfo {
  locked: boolean;
  volumeAllowed: boolean;
  holdUnlocks: boolean;
  hasPin: boolean;
}

export type MasterAction = "play" | "pause" | "stop";

export interface OutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface OutputDevices {
  devices: OutputDevice[];
  current: OutputDevice | null;
  preferred: string | null;
  sampleRate: number;
}

/** Decoded waveform: 4 bytes per bin (peak, bass, mids, treble). */
export interface Waveform {
  binsPerSecond: number;
  bins: Uint8Array;
  count: number;
}

/** Every IPC call resolves to this; it never rejects, so the UI always gets a visible state. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
