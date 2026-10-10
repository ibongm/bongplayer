// What happens when something is dropped on a target.

import { backend } from "../ipc/backend";
import {
  addToCrate,
  loadToDeck,
  notify,
  openSource,
  refreshCrates,
  run,
  setQueue,
} from "../state/app";
import { expandFolder } from "../state/explorer";
import type { DragPayload, DropTarget } from "./drag";

const AUDIO = /\.(mp3|flac|wav|m4a|mp4|aac|ogg|oga|aif)$/i;

function deckName(v: string | null): "A" | "B" {
  return v === "B" ? "B" : "A";
}

export async function performDrop(payload: DragPayload, target: DropTarget): Promise<void> {
  const b = backend();
  switch (target.type) {
    case "deck": {
      const deck = deckName(target.value);
      if (payload.kind === "files") {
        const file = payload.paths.find((p) => AUDIO.test(p));
        if (!file) {
          notify("error", `Deck ${deck}: drop an audio file (mp3, flac, wav, m4a, ogg)`);
          return;
        }
        run(await b.deckLoadPath(deck, file), `Load to deck ${deck}`);
      } else {
        const id = payload.trackIds[0];
        if (id !== undefined) await loadToDeck(deck, id);
      }
      return;
    }
    case "queue":
    case "queue-item": {
      const before = target.type === "queue-item" && target.value !== null ? Number(target.value) : null;
      if (payload.kind === "queue") {
        setQueue(await b.queueMove(payload.uids, before), "Reorder Automix");
      } else if (payload.kind === "tracks") {
        setQueue(await b.queueAdd(payload.trackIds, before), "Add to Automix");
        notify("info", `${payload.trackIds.length} track(s) added to Automix`);
      } else {
        const r = await b.queueAddPaths(payload.paths, before);
        setQueue(r, "Add to Automix");
      }
      return;
    }
    case "crate": {
      const id = Number(target.value);
      if (payload.kind === "files") {
        const added = run(await b.crateAddPaths(id, payload.paths), "Add to crate");
        if (added !== null) notify("info", `${added} track(s) added`);
        await refreshCrates();
      } else {
        await addToCrate(id, payload.trackIds);
      }
      return;
    }
    case "folder-tree": {
      if (payload.kind !== "files") return;
      const first = payload.paths[0];
      if (first === undefined) return;
      // A folder: open it. A file: open the folder it is in.
      const listing = await b.listDir(first);
      const folder = listing.ok ? first : first.replace(/[\\/][^\\/]*$/, "");
      await expandFolder(folder);
      await openSource({ kind: "folder", path: folder });
      return;
    }
  }
}
