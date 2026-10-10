// In-memory stand-in for the Rust side, used by `npm run dev` (browser only) and by tests.
// It imitates the real commands closely enough to exercise every screen, with a small fake
// file system. Nothing here plays sound.

import type { Backend } from "./backend";
import type {
  CrateEntry,
  CrateInfo,
  CrateKind,
  DeckName,
  DeckSnapshot,
  DirListing,
  IpcResult,
  QueueEntry,
  StatusSnapshot,
  TrackRow,
  UiCommand,
} from "./types";

const ok = <T>(value: T): IpcResult<T> => ({ ok: true, value });
const fail = <T>(error: string): IpcResult<T> => ({ ok: false, error });
const resolve = <T>(r: IpcResult<T>): Promise<IpcResult<T>> => Promise.resolve(r);

export interface MockOptions {
  /** Tracks per music folder (default 40). */
  tracksPerFolder?: number;
  /** Extra folder with this many tracks, for large-library checks. */
  bigFolderTracks?: number;
}

const ARTISTS = [
  "Daft Punk",
  "Nirvana",
  "The Beatles",
  "Chuck Berry",
  "Deadmau5",
  "Massive Attack",
  "Röyksopp",
  "Dua Lipa",
  "Fatboy Slim",
  "Moby",
];
const KEYS = ["8A", "9B", "5A", "11B", "2A", "7B"];

function isAudioPath(p: string): boolean {
  return /\.(mp3|flac|wav|m4a|mp4|aac|ogg|oga|aif)$/i.test(p);
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

function parentOf(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 2 ? p.slice(0, i) : p.slice(0, 3);
}

interface FakeFile {
  path: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  key: string;
  durationMs: number;
}

interface MockDeck {
  trackId: number | null;
  position: number;
  playing: boolean;
  startedAt: number;
  pitch: number;
  pitchRange: number;
  keyLock: boolean;
  cues: (number | null)[];
}

export function createMockBackend(options: MockOptions = {}): Backend & {
  /** Paths of every fake folder that holds audio. */
  readonly folders: string[];
  /** Calls made, for test assertions: [command, args]. */
  readonly calls: [string, unknown][];
} {
  const perFolder = options.tracksPerFolder ?? 40;
  const music = "C:\\Users\\dj\\Music";
  const dirs = new Map<string, DirListing>();
  const files = new Map<string, FakeFile>();
  const calls: [string, unknown][] = [];

  function ensureDir(path: string): DirListing {
    let d = dirs.get(path);
    if (!d) {
      d = { folders: [], audioFiles: [], playlists: [] };
      dirs.set(path, d);
      const parent = parentOf(path);
      if (parent !== path) {
        const p = ensureDir(parent);
        if (!p.folders.some((f) => f.path === path)) {
          p.folders.push({ path, name: baseName(path) });
          p.folders.sort((a, b) => a.name.localeCompare(b.name));
        }
      }
    }
    return d;
  }

  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  function addFolder(path: string, count: number, genre: string): void {
    const d = ensureDir(path);
    for (let i = 1; i <= count; i++) {
      const artist = ARTISTS[Math.floor(rand() * ARTISTS.length)] ?? "Unknown";
      const title = `${genre} Track ${String(i).padStart(2, "0")}`;
      const file = `${path}\\${String(i).padStart(2, "0")} - ${artist} - ${title}.mp3`;
      d.audioFiles.push(file);
      files.set(file, {
        path: file,
        title,
        artist,
        genre,
        bpm: Math.round((80 + rand() * 90) * 10) / 10,
        key: KEYS[Math.floor(rand() * KEYS.length)] ?? "8A",
        durationMs: Math.round(150_000 + rand() * 200_000),
      });
    }
  }

  ensureDir("C:\\");
  ensureDir("E:\\");
  addFolder(`${music}\\House`, perFolder, "House");
  addFolder(`${music}\\Rock Classics`, perFolder, "Rock");
  addFolder(`${music}\\Hip Hop`, perFolder, "Hip Hop");
  addFolder("E:\\Party", Math.max(5, Math.floor(perFolder / 2)), "Pop");
  ensureDir("C:\\Users\\dj\\Downloads");
  const big = options.bigFolderTracks ?? 0;
  if (big > 0) addFolder(`${music}\\Big Archive`, big, "Techno");
  const musicDir = ensureDir(music);
  musicDir.playlists.push(`${music}\\Friday set.m3u8`);

  const rows = new Map<number, TrackRow>();
  const idByPath = new Map<string, number>();
  let nextId = 1;

  function register(path: string): TrackRow | null {
    const existing = idByPath.get(path);
    if (existing !== undefined) return rows.get(existing) ?? null;
    if (!isAudioPath(path)) return null;
    const f = files.get(path);
    const name = baseName(path).replace(/\.[^.]+$/, "");
    const [artist, title] = name.includes(" - ")
      ? [name.split(" - ").slice(-2)[0] ?? "", name.split(" - ").slice(-1)[0] ?? name]
      : ["", name];
    const row: TrackRow = {
      id: nextId++,
      path,
      title: f?.title ?? title,
      artist: f?.artist ?? artist,
      album: "",
      remix: "",
      genre: f?.genre ?? "",
      year: null,
      durationMs: f?.durationMs ?? 200_000,
      bpm: f?.bpm ?? null,
      key: f?.key ?? null,
      bpmIsManual: false,
      rating: 0,
      playCount: 0,
      lastPlayed: null,
      firstSeen: 1_700_000_000,
      hasCover: false,
      analyzed: false,
      missing: false,
    };
    rows.set(row.id, row);
    idByPath.set(path, row.id);
    return row;
  }

  function expand(paths: string[]): string[] {
    const out: string[] = [];
    const walk = (p: string): void => {
      const d = dirs.get(p);
      if (d) {
        out.push(...d.audioFiles);
        d.folders.forEach((f) => {
          walk(f.path);
        });
      } else if (isAudioPath(p)) {
        out.push(p);
      }
    };
    paths.forEach(walk);
    return out;
  }

  const settings = new Map<string, string>();

  // ----- crates -----
  interface MockCrate {
    id: number;
    name: string;
    kind: CrateKind;
    entries: { position: number; trackId: number }[];
    nextPos: number;
  }
  const crates = new Map<number, MockCrate>();
  let nextCrate = 1;
  const crateInfo = (c: MockCrate): CrateInfo => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    trackCount: c.entries.length,
  });
  function addToCrate(c: MockCrate, ids: number[]): number {
    let added = 0;
    for (const id of ids) {
      if (!rows.has(id)) continue;
      if (c.kind === "crate" && c.entries.some((e) => e.trackId === id)) continue;
      c.entries.push({ position: c.nextPos++, trackId: id });
      added++;
    }
    return added;
  }

  // ----- queue -----
  let queue: { uid: number; trackId: number }[] = [];
  let nextUid = 1;
  const queueEntries = (): QueueEntry[] =>
    queue.flatMap((q) => {
      const track = rows.get(q.trackId);
      return track ? [{ uid: q.uid, track }] : [];
    });
  function queueInsert(ids: number[], before: number | null): void {
    const at = before === null ? -1 : queue.findIndex((q) => q.uid === before);
    const items = ids.filter((id) => rows.has(id)).map((trackId) => ({ uid: nextUid++, trackId }));
    if (at < 0) queue.push(...items);
    else queue.splice(at, 0, ...items);
  }

  // ----- decks -----
  const newDeck = (): MockDeck => ({
    trackId: null,
    position: 0,
    playing: false,
    startedAt: 0,
    pitch: 0,
    pitchRange: 0.08,
    keyLock: false,
    cues: Array<number | null>(8).fill(null),
  });
  const decks: Record<DeckName, MockDeck> = { A: newDeck(), B: newDeck() };
  const now = (): number => Date.now() / 1000;
  function position(d: MockDeck): number {
    return d.playing ? d.position + (now() - d.startedAt) * (1 + d.pitch) : d.position;
  }
  function snapshotDeck(d: MockDeck): DeckSnapshot {
    const row = d.trackId === null ? undefined : rows.get(d.trackId);
    const duration = row?.durationMs ? row.durationMs / 1000 : null;
    let pos = position(d);
    let playing = d.playing;
    let ended = false;
    if (duration !== null && pos >= duration) {
      pos = duration;
      playing = false;
      ended = true;
    }
    return {
      loaded: row !== undefined,
      trackId: row?.id ?? null,
      title: row?.title ?? "",
      artist: row?.artist ?? "",
      path: row?.path ?? null,
      position: pos,
      duration,
      playing,
      ended,
      tempo: 1 + d.pitch,
      pitch: d.pitch,
      pitchRange: d.pitchRange,
      keyLock: d.keyLock,
      scratching: false,
      trackBpm: row?.bpm ?? null,
      bpm: row?.bpm != null ? row.bpm * (1 + d.pitch) : null,
      key: row?.key ?? null,
      decoded: row ? 1 : 0,
      decodeError: null,
      cues: [...d.cues],
    };
  }
  function load(deck: DeckName, id: number): IpcResult<TrackRow> {
    const row = rows.get(id);
    if (!row) return fail(`track ${id} not found`);
    decks[deck] = { ...newDeck(), trackId: id, pitchRange: decks[deck].pitchRange };
    return ok(row);
  }
  function command(c: UiCommand): IpcResult<null> {
    if (c.type === "crossfader" || c.type === "master" || c.type === "limiterCeiling") {
      return ok(null);
    }
    const d = decks[c.deck];
    switch (c.type) {
      case "play":
      case "pause":
      case "togglePlay": {
        if (d.trackId === null) return ok(null);
        const play = c.type === "play" || (c.type === "togglePlay" && !d.playing);
        d.position = position(d);
        d.playing = play;
        d.startedAt = now();
        return ok(null);
      }
      case "seek":
        d.position = Math.max(0, c.seconds);
        d.startedAt = now();
        return ok(null);
      case "jumpHotCue": {
        const cue = d.cues[c.slot];
        if (cue != null) {
          d.position = cue;
          d.startedAt = now();
        }
        return ok(null);
      }
      case "pitch":
        d.position = position(d);
        d.startedAt = now();
        d.pitch = Math.max(-d.pitchRange, Math.min(d.pitchRange, c.pitch));
        return ok(null);
      case "pitchRange":
        d.pitchRange = c.range;
        d.pitch = Math.max(-c.range, Math.min(c.range, d.pitch));
        return ok(null);
      case "keyLock":
        d.keyLock = c.on;
        return ok(null);
      default:
        return ok(null);
    }
  }

  const b: Backend = {
    appInfo: () => resolve(ok({ name: "BongPlayer", version: "dev (browser, no Rust)" })),
    engineStatus: () => {
      const snap: StatusSnapshot = {
        decks: [snapshotDeck(decks.A), snapshotDeck(decks.B)],
        sampleRate: 48_000,
        output: { running: false, device: null, reopens: 0, problem: "browser preview: no audio" },
      };
      return resolve(ok(snap));
    },
    listDrives: () =>
      resolve(
        ok([
          { path: "C:\\", label: "C:", kind: "fixed" as const },
          { path: "E:\\", label: "E:", kind: "removable" as const },
        ]),
      ),
    specialFolders: () =>
      resolve(
        ok([
          { path: music, name: "Music" },
          { path: "C:\\Users\\dj\\Downloads", name: "Downloads" },
          { path: "C:\\Users\\dj", name: "Home" },
        ]),
      ),
    listDir: (path) => {
      const d = dirs.get(path);
      return resolve(d ? ok(structuredClone(d)) : fail(`cannot open ${path}: not found`));
    },
    showInExplorer: (path) => {
      calls.push(["showInExplorer", path]);
      return resolve(ok(null));
    },
    folderTracks: (path) => {
      const d = dirs.get(path);
      if (!d) return resolve(fail(`cannot open ${path}: not found`));
      const list = d.audioFiles.flatMap((f) => {
        const r = register(f);
        return r ? [r] : [];
      });
      return resolve(ok({ rows: list, stats: { cached: 0, read: list.length } }));
    },
    libraryTracks: () => resolve(ok([...rows.values()])),
    importPaths: (paths) =>
      resolve(
        ok(
          expand(paths).flatMap((p) => {
            const r = register(p);
            return r ? [r] : [];
          }),
        ),
      ),
    cratesList: () => resolve(ok([...crates.values()].map(crateInfo))),
    crateCreate: (name, kind) => {
      if (name.trim() === "") return resolve(fail("name must not be empty"));
      const id = nextCrate++;
      crates.set(id, { id, name: name.trim(), kind, entries: [], nextPos: 0 });
      return resolve(ok(id));
    },
    crateRename: (id, name) => {
      const c = crates.get(id);
      if (!c) return resolve(fail(`not found: crate ${id}`));
      if (name.trim() === "") return resolve(fail("name must not be empty"));
      c.name = name.trim();
      return resolve(ok(null));
    },
    crateDelete: (id) =>
      resolve(crates.delete(id) ? ok(null) : fail(`not found: crate ${id}`)),
    crateTracks: (id) => {
      const c = crates.get(id);
      if (!c) return resolve(fail(`not found: crate ${id}`));
      const list: CrateEntry[] = c.entries.flatMap((e) => {
        const track = rows.get(e.trackId);
        return track ? [{ position: e.position, track }] : [];
      });
      return resolve(ok(list));
    },
    crateAdd: (id, trackIds) => {
      calls.push(["crateAdd", { id, trackIds }]);
      const c = crates.get(id);
      return resolve(c ? ok(addToCrate(c, trackIds)) : fail(`not found: crate ${id}`));
    },
    crateAddPaths: (id, paths) => {
      const c = crates.get(id);
      if (!c) return resolve(fail(`not found: crate ${id}`));
      const ids = expand(paths).flatMap((p) => register(p)?.id ?? []);
      return resolve(ok(addToCrate(c, ids)));
    },
    crateRemove: (id, positions) => {
      const c = crates.get(id);
      if (!c) return resolve(fail(`not found: crate ${id}`));
      const before = c.entries.length;
      c.entries = c.entries.filter((e) => !positions.includes(e.position));
      return resolve(ok(before - c.entries.length));
    },
    importM3u: (path) => {
      const name = baseName(path).replace(/\.[^.]+$/, "");
      const id = nextCrate++;
      const c: MockCrate = { id, name, kind: "playlist", entries: [], nextPos: 0 };
      crates.set(id, c);
      const sample = (dirs.get(`${music}\\House`)?.audioFiles ?? []).slice(0, 5);
      const added = addToCrate(c, sample.flatMap((p) => register(p)?.id ?? []));
      return resolve(ok({ crateId: id, name, added, missing: ["Old Mix.mp3"] }));
    },
    analyzeTracks: (trackIds) => {
      calls.push(["analyzeTracks", trackIds]);
      let n = 0;
      for (const id of trackIds) {
        const r = rows.get(id);
        if (r) {
          rows.set(id, { ...r, analyzed: true, bpm: r.bpm ?? 120, key: r.key ?? "8A" });
          n++;
        }
      }
      return resolve(ok({ analyzed: n, failed: [], seconds: 0.01 }));
    },
    markPlayed: (trackIds) => {
      calls.push(["markPlayed", trackIds]);
      let n = 0;
      for (const id of trackIds) {
        const r = rows.get(id);
        if (r) {
          rows.set(id, { ...r, playCount: r.playCount + 1, lastPlayed: Math.floor(Date.now() / 1000) });
          n++;
        }
      }
      return resolve(ok(n));
    },
    removeTracks: (trackIds) => {
      calls.push(["removeTracks", trackIds]);
      let n = 0;
      for (const id of trackIds) {
        const r = rows.get(id);
        if (r) {
          rows.delete(id);
          idByPath.delete(r.path);
          n++;
        }
      }
      queue = queue.filter((q) => rows.has(q.trackId));
      for (const c of crates.values()) c.entries = c.entries.filter((e) => rows.has(e.trackId));
      return resolve(ok(n));
    },
    setRating: (trackIds, rating) => {
      for (const id of trackIds) {
        const r = rows.get(id);
        if (r) rows.set(id, { ...r, rating: Math.min(5, Math.max(0, rating)) });
      }
      return resolve(ok(trackIds.length));
    },
    setBpm: (trackIds, bpm) => {
      if (bpm !== null && (bpm < 20 || bpm >= 400)) {
        return resolve(fail("BPM must be between 20 and 400"));
      }
      for (const id of trackIds) {
        const r = rows.get(id);
        if (r) rows.set(id, { ...r, bpm, bpmIsManual: bpm !== null });
      }
      return resolve(ok(trackIds.length));
    },
    settingGet: (key) => resolve(ok(settings.get(key) ?? null)),
    settingSet: (key, value) => {
      settings.set(key, value);
      return resolve(ok(null));
    },
    deckLoad: (deck, trackId) => {
      calls.push(["deckLoad", { deck, trackId }]);
      return resolve(load(deck, trackId));
    },
    deckLoadPath: (deck, path) => {
      calls.push(["deckLoadPath", { deck, path }]);
      const r = register(path);
      return resolve(r ? load(deck, r.id) : fail(`not a playable audio file: ${path}`));
    },
    hotCueSet: (deck, slot) => {
      const d = decks[deck];
      if (d.trackId === null) return resolve(fail("no track loaded"));
      d.cues[slot] = position(d);
      return resolve(ok(null));
    },
    hotCueClear: (deck, slot) => {
      decks[deck].cues[slot] = null;
      return resolve(ok(null));
    },
    engineCommand: (c) => {
      calls.push(["engineCommand", c]);
      return resolve(command(c));
    },
    queueList: () => resolve(ok(queueEntries())),
    queueAdd: (trackIds, before) => {
      calls.push(["queueAdd", { trackIds, before }]);
      queueInsert(trackIds, before);
      return resolve(ok(queueEntries()));
    },
    queueAddPaths: (paths, before) => {
      calls.push(["queueAddPaths", { paths, before }]);
      const ids = expand(paths).flatMap((p) => register(p)?.id ?? []);
      queueInsert(ids, before);
      return resolve(ok(queueEntries()));
    },
    queueMove: (uids, before) => {
      calls.push(["queueMove", { uids, before }]);
      const moving = queue.filter((q) => uids.includes(q.uid));
      const rest = queue.filter((q) => !uids.includes(q.uid));
      const at = before === null ? -1 : rest.findIndex((q) => q.uid === before);
      if (at < 0) rest.push(...moving);
      else rest.splice(at, 0, ...moving);
      queue = rest;
      return resolve(ok(queueEntries()));
    },
    queueRemove: (uids) => {
      queue = queue.filter((q) => !uids.includes(q.uid));
      return resolve(ok(queueEntries()));
    },
    queueClear: () => {
      queue = [];
      return resolve(ok(queueEntries()));
    },
    queueShuffle: () => {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = queue[i];
        const other = queue[j];
        if (tmp && other) {
          queue[i] = other;
          queue[j] = tmp;
        }
      }
      return resolve(ok(queueEntries()));
    },
  };

  const folders = [...dirs.entries()]
    .filter(([, d]) => d.audioFiles.length > 0)
    .map(([p]) => p);
  return Object.assign(b, { folders, calls });
}
