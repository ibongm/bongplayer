import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getAppInfo } from "./ipc";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("BongPlayer: #root element missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <App appInfo={getAppInfo()} />
  </StrictMode>,
);
