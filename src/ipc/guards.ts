// Runtime checks for data coming from Rust. They check the shape the UI relies on, so a
// mismatch between Rust and TypeScript shows up as a clear error instead of a broken screen.

import type {
  AnalysisReport,
  AppInfo,
  CrateEntry,
  CrateInfo,
  DirListing,
  Drive,
  FolderEntry,
  FolderTracks,
  ImportReport,
  OutputDevice,
  OutputDevices,
  QueueEntry,
  StatusSnapshot,
  TrackRow,
} from "./types";

export type Guard<T> = (v: unknown) => v is T;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNumOrNull = (v: unknown): v is number | null => v === null || isNumber(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || isString(v);

export const isUnit = (v: unknown): v is null => v === null || v === undefined;
export { isNumber, isString };

export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (v: unknown): v is T[] => Array.isArray(v) && v.every(guard);
}

export function isAppInfo(v: unknown): v is AppInfo {
  return isRecord(v) && isString(v.name) && isString(v.version);
}

export function isTrackRow(v: unknown): v is TrackRow {
  return (
    isRecord(v) &&
    isNumber(v.id) &&
    isString(v.path) &&
    isString(v.title) &&
    isString(v.artist) &&
    isString(v.album) &&
    isString(v.remix) &&
    isString(v.genre) &&
    isNumOrNull(v.year) &&
    isNumOrNull(v.durationMs) &&
    isNumOrNull(v.bpm) &&
    isStrOrNull(v.key) &&
    isBool(v.bpmIsManual) &&
    isNumber(v.rating) &&
    isNumber(v.playCount) &&
    isNumOrNull(v.lastPlayed) &&
    isNumber(v.firstSeen) &&
    isBool(v.hasCover) &&
    isBool(v.analyzed) &&
    isBool(v.missing)
  );
}

export function isDrive(v: unknown): v is Drive {
  return isRecord(v) && isString(v.path) && isString(v.label) && isString(v.kind);
}

export function isFolderEntry(v: unknown): v is FolderEntry {
  return isRecord(v) && isString(v.path) && isString(v.name);
}

export function isDirListing(v: unknown): v is DirListing {
  return (
    isRecord(v) &&
    arrayOf(isFolderEntry)(v.folders) &&
    arrayOf(isString)(v.audioFiles) &&
    arrayOf(isString)(v.playlists)
  );
}

export function isFolderTracks(v: unknown): v is FolderTracks {
  return (
    isRecord(v) &&
    arrayOf(isTrackRow)(v.rows) &&
    isRecord(v.stats) &&
    isNumber(v.stats.cached) &&
    isNumber(v.stats.read)
  );
}

export function isCrateInfo(v: unknown): v is CrateInfo {
  return (
    isRecord(v) &&
    isNumber(v.id) &&
    isString(v.name) &&
    (v.kind === "crate" || v.kind === "playlist") &&
    isNumber(v.trackCount)
  );
}

export function isCrateEntry(v: unknown): v is CrateEntry {
  return isRecord(v) && isNumber(v.position) && isTrackRow(v.track);
}

export function isImportReport(v: unknown): v is ImportReport {
  return (
    isRecord(v) &&
    isNumber(v.crateId) &&
    isString(v.name) &&
    isNumber(v.added) &&
    arrayOf(isString)(v.missing)
  );
}

export function isAnalysisReport(v: unknown): v is AnalysisReport {
  return (
    isRecord(v) &&
    isNumber(v.analyzed) &&
    isNumber(v.seconds) &&
    Array.isArray(v.failed) &&
    v.failed.every(
      (f: unknown) => Array.isArray(f) && isNumber(f[0]) && isString(f[1]),
    )
  );
}

export function isQueueEntry(v: unknown): v is QueueEntry {
  return isRecord(v) && isNumber(v.uid) && isTrackRow(v.track);
}

const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNumber);

function isDeckSnapshot(v: unknown): boolean {
  return (
    isRecord(v) &&
    isBool(v.loaded) &&
    isNumber(v.position) &&
    isBool(v.playing) &&
    isNumber(v.tempo) &&
    isNumber(v.decoded) &&
    Array.isArray(v.cues) &&
    isNumber(v.mainCue) &&
    isNumber(v.keyShift) &&
    isBool(v.loopActive) &&
    isString(v.waveform) &&
    isPair(v.meter)
  );
}

function isOutputDevice(v: unknown): v is OutputDevice {
  return isRecord(v) && isString(v.id) && isString(v.name) && isBool(v.isDefault);
}

export function isOutputDevices(v: unknown): v is OutputDevices {
  return (
    isRecord(v) &&
    arrayOf(isOutputDevice)(v.devices) &&
    (v.current === null || isOutputDevice(v.current)) &&
    isStrOrNull(v.preferred) &&
    isNumber(v.sampleRate)
  );
}

export function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer;
}

export function isStatusSnapshot(v: unknown): v is StatusSnapshot {
  return (
    isRecord(v) &&
    Array.isArray(v.decks) &&
    v.decks.length === 2 &&
    v.decks.every(isDeckSnapshot) &&
    isNumber(v.sampleRate) &&
    isRecord(v.output) &&
    isPair(v.master)
  );
}
