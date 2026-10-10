// Renders the whole app against the in-memory mock backend, the way it runs in a browser.

import { act, render, screen, type RenderResult } from "@testing-library/react";
import { App } from "../App";
import { setDropHandler } from "../dnd/drag";
import { performDrop } from "../dnd/drop";
import { initBackend } from "../ipc/backend";
import { createMockBackend, type MockOptions } from "../ipc/mock";
import { browser, crates, notices, queue, status } from "../state/app";
import { emptySelection } from "../state/selection";
import { explorer } from "../state/explorer";
import { menuStore } from "../components/ContextMenu";
import { clearCoverCache } from "../components/Cover";
import { clearLyricsCache, lyricsDrawer } from "../state/lyrics";
import { pads, samplerOpen } from "../state/sampler";
import { DEFAULT_COLUMNS, tableColumns } from "../components/TrackTable";
import { DEFAULT_SKIN, applySkin, skins } from "../state/skins";
import { channelDefaults, dockTab, internetLookup, mixer, settingsOpen, view } from "../state/ui";

export type Mock = ReturnType<typeof createMockBackend>;

function resetStores(): void {
  browser.set({
    source: null,
    rows: [],
    loading: false,
    error: null,
    search: "",
    selection: emptySelection,
    stats: null,
  });
  crates.set([]);
  queue.set([]);
  notices.set([]);
  status.set(null);
  menuStore.set(null);
  explorer.set({ drives: [], places: [], nodes: {}, error: null });
  view.set("standard");
  settingsOpen.set(false);
  dockTab.set("automix");
  internetLookup.set(null);
  clearCoverCache();
  clearLyricsCache();
  lyricsDrawer.set(false);
  samplerOpen.set(false);
  pads.set([]);
  tableColumns.set(DEFAULT_COLUMNS);
  skins.set({ current: DEFAULT_SKIN, custom: [] });
  applySkin(skins.get());
  mixer.set({ A: { ...channelDefaults }, B: { ...channelDefaults }, crossfader: 0.5, master: 0 });
}

export async function renderApp(options: MockOptions = {}): Promise<{ mock: Mock; view: RenderResult }> {
  resetStores();
  const mock = createMockBackend(options);
  await initBackend(mock);
  setDropHandler(performDrop);
  const appInfo = mock.appInfo();
  const view = await act(async () => {
    const v = render(<App appInfo={appInfo} />);
    await appInfo;
    return v;
  });
  // Explorer roots load on mount.
  await screen.findByRole("treeitem", { name: /Music/ });
  return { mock, view };
}

/** Makes `document.elementFromPoint` return `el` (jsdom has no layout). */
export function pointAt(el: Element | null): void {
  document.elementFromPoint = (): Element | null => el;
}
