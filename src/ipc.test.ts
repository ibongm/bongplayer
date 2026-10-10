import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  isTauri: vi.fn<() => boolean>(),
  invoke: vi.fn<(cmd: string) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => core);

import { getAppInfo } from "./ipc";

describe("getAppInfo", () => {
  beforeEach(() => {
    core.isTauri.mockReset();
    core.invoke.mockReset();
  });

  it("answers from the browser mock when not running inside Tauri", async () => {
    core.isTauri.mockReturnValue(false);
    const result = await getAppInfo();
    expect(result.ok).toBe(true);
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("calls the app_info Rust command inside Tauri", async () => {
    core.isTauri.mockReturnValue(true);
    core.invoke.mockResolvedValue({ name: "BongPlayer", version: "0.1.0" });
    const result = await getAppInfo();
    expect(core.invoke).toHaveBeenCalledWith("app_info");
    expect(result).toEqual({ ok: true, value: { name: "BongPlayer", version: "0.1.0" } });
  });

  it("turns a Rust error into an error result instead of throwing", async () => {
    core.isTauri.mockReturnValue(true);
    core.invoke.mockRejectedValue("command app_info not found");
    const result = await getAppInfo();
    expect(result).toEqual({ ok: false, error: "command app_info not found" });
  });

  it("rejects a payload with the wrong shape", async () => {
    core.isTauri.mockReturnValue(true);
    core.invoke.mockResolvedValue({ name: 42 });
    const result = await getAppInfo();
    expect(result.ok).toBe(false);
  });
});
