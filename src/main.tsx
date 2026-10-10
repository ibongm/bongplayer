import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setDropHandler } from "./dnd/drag";
import { performDrop } from "./dnd/drop";
import { listenNativeDrops } from "./dnd/nativeDrop";
import { initBackend } from "./ipc/backend";
import { startStatusFeed } from "./state/statusFeed";
import "./styles/index.css";

async function start(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("BongPlayer: #root element missing from index.html");
  }
  const b = await initBackend();
  setDropHandler(performDrop);
  await startStatusFeed();
  await listenNativeDrops();
  createRoot(root).render(
    <StrictMode>
      <App appInfo={b.appInfo()} />
    </StrictMode>,
  );
}

void start();
