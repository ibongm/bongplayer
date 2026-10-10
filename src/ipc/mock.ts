// In-memory stand-in for the Rust side, used by `npm run dev` (browser only) and by tests.
// It imitates the real commands closely enough to exercise every screen, with a small fake
// file system. Nothing here plays sound.

import type { Backend } from "./backend";
import type {
  PadInfo,
  AutomixConfig,
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
  /** Name of a connected controller ("DDJ-400"), or none. */
  midiDevice?: string;
  /** Skin files the stand-in can "read": path → text. */
  skinFiles?: Record<string, string>;
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
  mainCue: number;
  cuePreview: boolean;
  keyShift: number;
  loopIn: number | null;
  loopOut: number | null;
  loopActive: boolean;
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
    const id = nextId++;
    const row: TrackRow = {
      id,
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
      // Every third track has a cover (see trackCover).
      hasCover: id % 3 === 0,
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
  let automixOn = false;
  let automixConfig: AutomixConfig = {
    triggerSeconds: 8,
    crossfadeSeconds: 6,
    style: "smooth",
    loopQueue: true,
    shuffle: false,
    autoRemove: false,
  };
  let currentUid: number | null = null;
  let locked = false;
  let lockOpts = { volumeAllowed: true, holdUnlocks: true, pin: null as string | null };
  let duckOn = false;
  // Sampler: 8 pads; a triggered pad "plays" until stopped (the stand-in has no audio).
  type Pad = { path: string | null; gainDb: number; choke: number; seconds: number | null; error: string | null };
  const pads: Pad[] = Array.from({ length: 8 }, () => ({ path: null, gainDb: 0, choke: 0, seconds: null, error: null }));
  let padsPlaying = 0;
  const cue: [boolean, boolean] = [false, false];
  const padList = (): PadInfo[] =>
    pads.map((p, index) => ({
      index,
      name: p.path === null ? "" : baseName(p.path).replace(/\.[^.]+$/, ""),
      path: p.path,
      gainDb: p.gainDb,
      choke: p.choke,
      seconds: p.seconds,
      error: p.error,
    }));
  const padOk = (pad: number): boolean => Number.isInteger(pad) && pad >= 0 && pad < 8;
  const lockedError = <T>(): IpcResult<T> => fail("Locked — unlock with the PIN or by holding LOCK");
  const stations = new Map<number, { id: number; name: string; url: string; playMinutes: number }>();
  let nextStation = 1;
  const liveDeck: Record<DeckName, { name: string; url: string } | null> = { A: null, B: null };
  const stationRow = (id: number | null, name: string, url: string, minutes: number): TrackRow => ({
    id: -(id ?? 0) - 1,
    path: url,
    title: name,
    artist: "Internet radio",
    album: "",
    remix: "",
    genre: "",
    year: null,
    durationMs: minutes * 60_000,
    bpm: null,
    key: null,
    bpmIsManual: false,
    rating: 0,
    playCount: 0,
    lastPlayed: null,
    firstSeen: 0,
    hasCover: false,
    analyzed: false,
    missing: false,
  });
  const probeUrl = (url: string): IpcResult<string> => {
    if (!/^https?:\/\//i.test(url)) return fail(`network problem: not a web address: ${url}`);
    if (/\.html?(\?|$)|\.php(\?|$)/i.test(url)) {
      return fail("this is a web page, not a stream — open it in a browser and look for the stream link (often ending in .mp3, .aac, .pls or .m3u)");
    }
    return ok("Test Radio (audio/mpeg)");
  };

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
      if (q.trackId < 0) {
        const st = stations.get(-q.trackId - 1);
        return st ? [{ uid: q.uid, track: stationRow(st.id, st.name, st.url, st.playMinutes) }] : [];
      }
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
    mainCue: 0,
    cuePreview: false,
    keyShift: 0,
    loopIn: null,
    loopOut: null,
    loopActive: false,
  });
  const decks: Record<DeckName, MockDeck> = { A: newDeck(), B: newDeck() };
  const now = (): number => Date.now() / 1000;
  function position(d: MockDeck): number {
    return d.playing ? d.position + (now() - d.startedAt) * (1 + d.pitch) : d.position;
  }
  function snapshotDeck(d: MockDeck): DeckSnapshot {
    const lv = d === decks.A ? liveDeck.A : d === decks.B ? liveDeck.B : null;
    if (lv) {
      return {
        loaded: true,
        trackId: null,
        title: "Live Artist - Live Song",
        artist: lv.name,
        path: lv.url,
        position: position(d),
        duration: null,
        playing: d.playing,
        ended: false,
        tempo: 1,
        pitch: 0,
        pitchRange: d.pitchRange,
        keyLock: false,
        scratching: false,
        trackBpm: null,
        bpm: null,
        key: null,
        decoded: 1,
        decodeError: /\.html?|\.php/i.test(lv.url) ? "this is a web page, not a stream" : null,
        cues: Array<number | null>(8).fill(null),
        mainCue: 0,
        keyShift: 0,
        loopIn: null,
        loopOut: null,
        loopActive: false,
        waveform: "none",
        meter: d.playing ? [0.5, 0.35] : [0, 0],
        live: true,
        radioState: /\.html?|\.php/i.test(lv.url) ? "error: this is a web page, not a stream" : "playing",
      };
    }
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
      mainCue: d.mainCue,
      keyShift: d.keyShift,
      loopIn: d.loopIn,
      loopOut: d.loopOut,
      loopActive: d.loopActive,
      waveform: row ? "ready" : "none",
      meter: playing ? [0.5, 0.35] : [0, 0],
      live: false,
      radioState: null,
    };
  }
  function load(deck: DeckName, id: number): IpcResult<TrackRow> {
    const row = rows.get(id);
    if (!row) return fail(`track ${id} not found`);
    decks[deck] = { ...newDeck(), trackId: id, pitchRange: decks[deck].pitchRange };
    liveDeck[deck] = null;
    return ok(row);
  }
  function loadLive(deck: DeckName, name: string, url: string): void {
    decks[deck] = { ...newDeck(), pitchRange: decks[deck].pitchRange };
    liveDeck[deck] = { name, url };
  }
  function command(c: UiCommand): IpcResult<null> {
    const volume = c.type === "fader" || c.type === "master" || c.type === "cue" || c.type === "cueMix";
    if (locked && !(volume && lockOpts.volumeAllowed)) return lockedError();
    if (c.type === "crossfader" || c.type === "master" || c.type === "limiterCeiling" || c.type === "cueMix") {
      return ok(null);
    }
    if (c.type === "cue") {
      cue[c.deck === "A" ? 0 : 1] = c.on;
      return ok(null);
    }
    if (c.type === "fx" || c.type === "fxParams") return ok(null);
    const d = decks[c.deck];
    const jump = (t: number): void => {
      d.position = Math.max(0, t);
      d.startedAt = now();
    };
    switch (c.type) {
      case "play":
      case "pause":
      case "togglePlay": {
        if (d.trackId === null && !liveDeck[c.deck]) return ok(null);
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
      case "keyShift":
        d.keyShift = Math.max(-12, Math.min(12, c.semitones));
        return ok(null);
      case "cuePress":
        if (d.trackId === null) return ok(null);
        if (d.playing && !d.cuePreview) {
          d.playing = false;
          jump(d.mainCue);
        } else {
          d.mainCue = position(d);
          d.cuePreview = true;
          jump(d.mainCue);
          d.playing = true;
        }
        return ok(null);
      case "cueRelease":
        if (d.cuePreview) {
          d.cuePreview = false;
          d.playing = false;
          jump(d.mainCue);
        }
        return ok(null);
      case "cuePlay":
        if (d.trackId === null) return ok(null);
        jump(d.mainCue);
        d.playing = true;
        return ok(null);
      case "loopIn":
        d.loopIn = position(d);
        return ok(null);
      case "loopOut": {
        const here = position(d);
        if (d.loopIn !== null && here > d.loopIn) {
          d.loopOut = here;
          d.loopActive = true;
        }
        return ok(null);
      }
      case "autoLoop": {
        const row = d.trackId === null ? undefined : rows.get(d.trackId);
        if (!row?.bpm) return fail("auto-loop needs the track's BPM (analyze it or use TAP)");
        const start = position(d);
        d.loopIn = start;
        d.loopOut = start + (c.beats * 60) / row.bpm;
        d.loopActive = true;
        return ok(null);
      }
      case "loopResize":
        if (d.loopIn !== null && d.loopOut !== null) {
          d.loopOut = d.loopIn + (d.loopOut - d.loopIn) * c.factor;
        }
        return ok(null);
      case "loopExit":
        d.loopActive = false;
        return ok(null);
      case "loopReenter":
        d.loopActive = d.loopIn !== null && d.loopOut !== null;
        return ok(null);
      case "sync": {
        const other = decks[c.deck === "A" ? "B" : "A"];
        const mine = d.trackId === null ? null : (rows.get(d.trackId)?.bpm ?? null);
        const theirs = other.trackId === null ? null : (rows.get(other.trackId)?.bpm ?? null);
        if (mine === null || theirs === null) return fail("SYNC needs both decks' BPM");
        d.position = position(d);
        d.startedAt = now();
        d.pitch = (theirs * (1 + other.pitch)) / mine - 1;
        return ok(null);
      }
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
        master: decks.A.playing || decks.B.playing ? [0.6, 0.4] : [0, 0],
        crossfader: 0.5,
        automix: {
          on: automixOn,
          currentUid,
          nextUid: queue.find((q) => q.uid !== currentUid)?.uid ?? null,
          transitioning: false,
          config: { ...automixConfig },
          message: automixOn && queue.length === 0 ? "queue is empty: add tracks to Automix" : null,
        },
        locked,
        duckOn,
        duckDb: duckOn ? -12 : 0,
        padsPlaying,
        samplerDuckDb: padsPlaying !== 0 ? -9 : 0,
        cue: [cue[0], cue[1]],
        outputChannels: 2,
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
    deckWaveform: (trackId) => {
      const row = rows.get(trackId);
      if (!row) return resolve(fail("no waveform for this track"));
      // A synthetic waveform: beats every half second, louder in the middle of the track.
      const seconds = (row.durationMs ?? 200_000) / 1000;
      const binsPerSecond = 150;
      const count = Math.round(seconds * binsPerSecond);
      const bins = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        const t = i / binsPerSecond;
        const beat = Math.exp(-((t % 0.5) / 0.08));
        const shape = 0.5 + 0.5 * Math.sin((Math.PI * t) / seconds);
        bins[i * 4] = Math.round(255 * Math.min(1, 0.3 + 0.7 * beat) * shape);
        bins[i * 4 + 1] = Math.round(230 * beat * shape);
        bins[i * 4 + 2] = Math.round(140 * shape);
        bins[i * 4 + 3] = Math.round(90 * (1 - beat) * shape);
      }
      return resolve(ok({ binsPerSecond, count, bins }));
    },
    outputDevices: () =>
      resolve(
        ok({
          devices: [
            { id: "speakers", name: "Speakers (Realtek)", isDefault: true },
            { id: "ddj-400", name: "DDJ-400", isDefault: false },
          ],
          current: { id: "speakers", name: "Speakers (Realtek)", isDefault: true },
          preferred: settings.get("audio.preferred_output") ?? null,
          sampleRate: 48_000,
        }),
      ),
    setPreferredOutput: (id) => {
      calls.push(["setPreferredOutput", id]);
      if (id === null) settings.delete("audio.preferred_output");
      else settings.set("audio.preferred_output", id);
      return resolve(ok(null));
    },
    automixStart: () => {
      calls.push(["automixStart", null]);
      if (locked) return resolve(lockedError());
      automixOn = true;
      const first = queue[0];
      if (first && currentUid === null) {
        currentUid = first.uid;
        load("A", first.trackId);
        decks.A.playing = true;
        decks.A.startedAt = now();
      }
      return resolve(ok(null));
    },
    automixStop: () => {
      calls.push(["automixStop", null]);
      if (locked) return resolve(lockedError());
      automixOn = false;
      return resolve(ok(null));
    },
    automixSkip: () => {
      calls.push(["automixSkip", null]);
      if (locked) return resolve(lockedError());
      if (!automixOn) return resolve(fail("Automix is off"));
      const i = queue.findIndex((q) => q.uid === currentUid);
      const next = queue[i + 1];
      if (!next) return resolve(fail("there is no next track in the queue"));
      currentUid = next.uid;
      load("B", next.trackId);
      decks.B.playing = true;
      decks.B.startedAt = now();
      return resolve(ok(null));
    },
    automixConfig: (config) => {
      calls.push(["automixConfig", config]);
      if (locked) return resolve(lockedError());
      automixConfig = { ...config };
      return resolve(ok(null));
    },
    masterTransport: (action) => {
      calls.push(["masterTransport", action]);
      if (locked) return resolve(lockedError());
      if (action === "stop") automixOn = false;
      if (action !== "play") {
        decks.A.playing = false;
        decks.B.playing = false;
      }
      return resolve(ok(null));
    },
    lockInfo: () =>
      resolve(
        ok({
          locked,
          volumeAllowed: lockOpts.volumeAllowed,
          holdUnlocks: lockOpts.holdUnlocks,
          hasPin: lockOpts.pin !== null,
        }),
      ),
    lockEngage: () => {
      calls.push(["lockEngage", null]);
      locked = true;
      return resolve(ok(null));
    },
    lockRelease: (pin, hold) => {
      calls.push(["lockRelease", { pin, hold }]);
      if (hold && lockOpts.holdUnlocks) {
        locked = false;
        return resolve(ok(null));
      }
      if (lockOpts.pin === null || pin === lockOpts.pin) {
        if (hold && !lockOpts.holdUnlocks) {
          return resolve(fail("Unlocking by holding LOCK is switched off — enter the PIN"));
        }
        locked = false;
        return resolve(ok(null));
      }
      return resolve(fail("Wrong PIN"));
    },
    lockConfigure: (volumeAllowed, holdUnlocks, currentPin, newPin) => {
      calls.push(["lockConfigure", { volumeAllowed, holdUnlocks, currentPin, newPin }]);
      if (locked) return resolve(fail("Unlock first to change the lock settings"));
      if (newPin !== null) {
        if (lockOpts.pin !== null && currentPin !== lockOpts.pin) {
          return resolve(fail("Enter the current PIN to change it"));
        }
        if (newPin !== "" && !/^\d{4,}$/.test(newPin)) {
          return resolve(fail("The PIN must be at least 4 digits"));
        }
        lockOpts.pin = newPin === "" ? null : newPin;
      }
      lockOpts = { ...lockOpts, volumeAllowed, holdUnlocks };
      return resolve(ok(null));
    },
    duck: (on) => {
      calls.push(["duck", on]);
      if (locked && !lockOpts.volumeAllowed) return resolve(lockedError());
      duckOn = on;
      return resolve(ok(null));
    },
    duckDepth: (db) => {
      settings.set("duck.depth_db", String(db));
      return resolve(ok(null));
    },
    radioPresets: () =>
      resolve(
        ok([
          { name: "Bravo (Live)", url: "https://relay1.social3.hr/radio/8310/radio.mp3" },
          { name: "Radio Dalmacija", url: "http://shoutcast.pondi.hr:8000/listen.pls" },
        ]),
      ),
    stationsList: () => resolve(ok([...stations.values()].sort((a, b) => a.name.localeCompare(b.name)))),
    stationSave: (id, name, url, playMinutes) => {
      calls.push(["stationSave", { id, name, url, playMinutes }]);
      if (name.trim() === "") return resolve(fail("the station needs a name"));
      if (!/^https?:\/\//i.test(url)) return resolve(fail("the address must start with http:// or https://"));
      const existing = [...stations.values()].find((st) => st.url === url.trim());
      const sid = id ?? existing?.id ?? nextStation++;
      stations.set(sid, { id: sid, name: name.trim(), url: url.trim(), playMinutes });
      return resolve(ok(sid));
    },
    stationDelete: (id) => {
      calls.push(["stationDelete", id]);
      return resolve(stations.delete(id) ? ok(null) : fail(`not found: station ${id}`));
    },
    stationProbe: (url) => {
      calls.push(["stationProbe", url]);
      return resolve(probeUrl(url));
    },
    deckLoadStation: (deck, id) => {
      calls.push(["deckLoadStation", { deck, id }]);
      if (locked) return resolve(lockedError());
      const st = stations.get(id);
      if (!st) return resolve(fail(`not found: station ${id}`));
      loadLive(deck, st.name, st.url);
      return resolve(ok(stationRow(st.id, st.name, st.url, st.playMinutes)));
    },
    deckLoadUrl: (deck, url, name) => {
      calls.push(["deckLoadUrl", { deck, url, name }]);
      if (locked) return resolve(lockedError());
      if (!/^https?:\/\//i.test(url)) return resolve(fail("a station address must start with http:// or https://"));
      loadLive(deck, name ?? url, url);
      return resolve(ok(stationRow(null, name ?? url, url, 60)));
    },
    queueAddStation: (id, before) => {
      calls.push(["queueAddStation", { id, before }]);
      if (locked) return resolve(lockedError());
      const st = stations.get(id);
      if (!st) return resolve(fail(`not found: station ${id}`));
      const uid = nextUid++;
      const at = before === null ? -1 : queue.findIndex((q) => q.uid === before);
      const item = { uid, trackId: -st.id - 1 };
      if (at < 0) queue.push(item);
      else queue.splice(at, 0, item);
      return resolve(ok(queueEntries()));
    },
    trackCover: (trackId) => {
      // Every third track has a cover in the stand-in library.
      if (!rows.has(trackId) || trackId % 3 !== 0) return resolve(fail("no cover"));
      // A tiny valid PNG (1 × 1 pixel).
      const png = Uint8Array.from(
        atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
        (c) => c.charCodeAt(0),
      );
      return resolve(ok(png.buffer));
    },
    midiStatus: () =>
      resolve(
        ok({
          enabled: settings.get("midi.enabled") !== "0",
          device: options.midiDevice ?? null,
          leds: options.midiDevice !== undefined,
          inputs: options.midiDevice === undefined ? [] : [options.midiDevice],
          error: null,
        }),
      ),
    midiEnable: (on) => {
      calls.push(["midiEnable", on]);
      settings.set("midi.enabled", on ? "1" : "0");
      return resolve(ok(null));
    },
    libraryInfo: () => resolve(ok({ database: "C:\\Users\\dj\\AppData\\Roaming\\BongPlayer\\library.db", tracks: rows.size })),
    skinFileRead: (path) => {
      calls.push(["skinFileRead", path]);
      const text = options.skinFiles?.[path];
      if (!/\.json$/i.test(path)) return resolve(fail("a skin file must be a .json file"));
      return resolve(text === undefined ? fail(`cannot read ${path}: not found`) : ok(text));
    },
    samplerPads: () => resolve(ok(padList())),
    samplerLoad: (pad, path) => {
      calls.push(["samplerLoad", { pad, path }]);
      if (!padOk(pad)) return resolve(fail("there are 8 pads (1–8)"));
      if (locked) return resolve(lockedError());
      if (!isAudioPath(path)) return resolve(fail(`not a playable audio file: ${path}`));
      const p = pads[pad];
      if (p) Object.assign(p, { path, seconds: 3, error: null });
      return resolve(ok(padList()));
    },
    samplerClear: (pad) => {
      calls.push(["samplerClear", pad]);
      if (locked) return resolve(lockedError());
      const p = pads[pad];
      if (!p) return resolve(fail("there are 8 pads (1–8)"));
      Object.assign(p, { path: null, gainDb: 0, choke: 0, seconds: null, error: null });
      padsPlaying &= ~(1 << pad);
      return resolve(ok(padList()));
    },
    samplerConfigure: (pad, gainDb, choke) => {
      calls.push(["samplerConfigure", { pad, gainDb, choke }]);
      if (locked) return resolve(lockedError());
      const p = pads[pad];
      if (!p) return resolve(fail("there are 8 pads (1–8)"));
      if (choke < 0 || choke > 4) return resolve(fail("choke group must be 0 (none) or 1–4"));
      Object.assign(p, { gainDb: Math.max(-120, Math.min(6, gainDb)), choke });
      return resolve(ok(padList()));
    },
    samplerTrigger: (pad) => {
      calls.push(["samplerTrigger", pad]);
      const p = pads[pad];
      if (!p) return resolve(fail("there are 8 pads (1–8)"));
      if (p.seconds === null) return resolve(fail(`pad ${pad + 1} is empty — drop a sound on it`));
      if (p.choke !== 0) pads.forEach((o, i) => {
        if (i !== pad && o.choke === p.choke) padsPlaying &= ~(1 << i);
      });
      padsPlaying |= 1 << pad;
      return resolve(ok(null));
    },
    samplerStop: (pad) => {
      calls.push(["samplerStop", pad]);
      padsPlaying = pad === null ? 0 : padsPlaying & ~(1 << pad);
      return resolve(ok(null));
    },
    trackLyrics: (trackId) => {
      calls.push(["trackLyrics", trackId]);
      if (!rows.has(trackId)) return resolve(fail(`track ${trackId} not found`));
      // Even-numbered tracks have a .lrc file in the stand-in library: a line every 5 s.
      if (trackId % 2 !== 0) return resolve(ok(null));
      const lines = ["♪", "First line", "Second line", "Third line", "Fourth line", "Last line"].map((text, i) => ({
        ms: i * 5000,
        text,
      }));
      return resolve(ok({ lines, synced: true, source: "file", instrumental: false }));
    },
    lookupTrack: (trackId) => {
      calls.push(["lookupTrack", trackId]);
      if (settings.get("internet.lookup") !== "1") {
        return resolve(fail("Internet lookup is off — switch it on in Settings → Internet"));
      }
      const r = rows.get(trackId);
      if (!r) return resolve(fail(`track ${trackId} not found`));
      if (r.album !== "") return resolve(ok({ fetched: false, filled: [], cover: false, source: null }));
      rows.set(trackId, { ...r, album: "Looked-up Album", year: r.year ?? 1999 });
      return resolve(ok({ fetched: true, filled: ["album", "year"], cover: false, source: "MusicBrainz" }));
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
