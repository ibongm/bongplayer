import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { AppInfo, IpcResult } from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));

import { App } from "./App";

const okInfo: IpcResult<AppInfo> = { ok: true, value: { name: "BongPlayer", version: "0.1.0" } };

/** Renders the app and lets React finish suspending on the IPC promise. */
async function renderApp(result: IpcResult<AppInfo>) {
  const appInfo = Promise.resolve(result);
  return await act(async () => {
    const view = render(<App appInfo={appInfo} />);
    await appInfo;
    return view;
  });
}

describe("App shell", () => {
  it("shows the app name and the version reported by Rust", async () => {
    await renderApp(okInfo);
    expect(screen.getByTestId("app-version")).toHaveTextContent("v0.1.0");
    expect(screen.getByText("BongPlayer")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a visible error when Rust cannot be reached", async () => {
    await renderApp({ ok: false, error: "IPC unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("IPC unavailable");
    expect(screen.getByTestId("app-version")).toHaveTextContent("version unknown");
  });

  it("has window controls with tooltips that name their shortcut", async () => {
    await renderApp(okInfo);
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute(
      "title",
      expect.stringContaining("Alt+F4"),
    );
    expect(screen.getByRole("button", { name: "Minimise" })).toHaveAttribute(
      "title",
      expect.stringContaining("Win+↓"),
    );
    expect(screen.getByRole("button", { name: "Maximise or restore" })).toHaveAttribute(
      "title",
      expect.stringContaining("Win+↑"),
    );
  });

  it("marks the titlebar as the window drag region, but not its buttons", async () => {
    const { container } = await renderApp(okInfo);
    expect(container.querySelector("header")).toHaveAttribute("data-tauri-drag-region");
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("data-tauri-drag-region");
    }
  });
});
