// A track's cover picture (embedded, folder.jpg or looked up), fetched from Rust once and
// kept as an object URL. Tracks without a cover show a plain note symbol.

import { useEffect, useState, type ReactNode } from "react";
import { backend } from "../ipc/backend";

const MAX_CACHED = 400;
/** Key "id:size" → object URL. */
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function makeUrl(bytes: ArrayBuffer): string | null {
  if (typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

function remember(key: string, url: string): void {
  cache.set(key, url);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const old = cache.get(oldest);
    if (old !== undefined) URL.revokeObjectURL(old);
    cache.delete(oldest);
  }
}

function coverUrl(trackId: number, large: boolean): Promise<string | null> {
  const key = `${trackId}:${large ? "L" : "S"}`;
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const p = backend()
    .trackCover(trackId, large)
    .then((r) => {
      const url = r.ok ? makeUrl(r.value) : null;
      // "No cover" is not remembered: a lookup may add one later.
      if (url !== null) remember(key, url);
      return url;
    })
    .catch(() => null)
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, p);
  return p;
}

/** Forgets a track's cover so the next view fetches it again (after an internet lookup). */
export function forgetCover(trackId: number): void {
  for (const size of ["S", "L"]) {
    const key = `${trackId}:${size}`;
    const old = cache.get(key);
    if (old !== undefined) URL.revokeObjectURL(old);
    cache.delete(key);
  }
}

/** Forgets every cached cover (tests start each app from scratch). */
export function clearCoverCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  pending.clear();
}

export function Cover({
  trackId,
  size,
  large = false,
  version = 0,
}: {
  trackId: number | null;
  /** Display size in pixels. */
  size: number;
  /** Fetch the large (400 px) picture instead of the 64 px thumbnail. */
  large?: boolean;
  /** Bump to re-fetch (after a lookup added a cover). */
  version?: number;
}): ReactNode {
  const [url, setUrl] = useState<{ id: number | null; url: string | null }>({ id: null, url: null });

  useEffect(() => {
    if (trackId === null || trackId < 0) return;
    let live = true;
    void coverUrl(trackId, large).then((u) => {
      if (live) setUrl({ id: trackId, url: u });
    });
    return () => {
      live = false;
    };
  }, [trackId, large, version]);

  const shown = url.id === trackId ? url.url : null;
  return shown ? (
    <img
      src={shown}
      alt="Cover"
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 rounded-sm object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      aria-label="No cover"
      role="img"
      className="flex shrink-0 items-center justify-center rounded-sm bg-surface-raised text-muted"
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.45) }}
    >
      ♪
    </div>
  );
}
