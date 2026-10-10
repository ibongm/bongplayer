import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  isTauri: vi.fn<() => boolean>(),
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => core);

import { initBackend, tauriBackend } from "./backend";

const row = {
  id: 1,
  path: "C:\\m\\a.mp3",
  title: "A",
  artist: "B",
  album: "",
  remix: "",
  genre: "",
  year: null,
  durationMs: 1000,
  bpm: 120,
  key: "8A",
  bpmIsManual: false,
  rating: 0,
  playCount: 0,
  lastPlayed: null,
  firstSeen: 0,
  hasCover: false,
  analyzed: true,
  missing: false,
};

describe("IPC layer", () => {
  beforeEach(() => {
    core.isTauri.mockReset();
    core.invoke.mockReset();
  });

  it("uses the in-browser mock when not running inside Tauri", async () => {
    core.isTauri.mockReturnValue(false);
    const b = await initBackend();
    const info = await b.appInfo();
    expect(info.ok).toBe(true);
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("calls the Rust command with its arguments inside Tauri", async () => {
    core.invoke.mockResolvedValue(row);
    const r = await tauriBackend.deckLoad("B", 1);
    expect(core.invoke).toHaveBeenCalledWith("deck_load", { deck: "B", trackId: 1 });
    expect(r).toEqual({ ok: true, value: row });
  });

  it("turns a Rust error into an error result instead of throwing", async () => {
    core.invoke.mockRejectedValue("file not found: C:\\m\\a.mp3");
    const r = await tauriBackend.deckLoad("A", 1);
    expect(r).toEqual({ ok: false, error: "file not found: C:\\m\\a.mp3" });
  });

  it("rejects a payload with the wrong shape", async () => {
    core.invoke.mockResolvedValue({ ...row, title: 5 });
    const r = await tauriBackend.deckLoad("A", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unexpected shape");
  });

  it("accepts unit results for commands that return nothing", async () => {
    core.invoke.mockResolvedValue(null);
    expect(await tauriBackend.engineCommand({ type: "play", deck: "A" })).toEqual({
      ok: true,
      value: null,
    });
    expect(core.invoke).toHaveBeenCalledWith("engine_command", {
      command: { type: "play", deck: "A" },
    });
  });
});
