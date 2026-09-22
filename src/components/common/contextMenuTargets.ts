import type { DeckId, SlotIndex } from "../../types/deck";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useAutomixStore } from "../../store/useAutomixStore";
import { useSamplerStore, type ChokeGroup } from "../../store/useSamplerStore";
import { loadTrackMetadata } from "../../services/trackLoader";

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}

/**
 * What was right-clicked, per AGENTS.md §2.2's per-target action lists.
 * "knob" carries its own reset callback since knobs/sliders are generic
 * controls (Phase 6) with no shared store shape to resolve against here.
 */
export type ContextMenuTarget =
  | { readonly kind: "deck"; readonly deck: DeckId }
  | { readonly kind: "trackRow"; readonly filePath: string; readonly fileName: string }
  | { readonly kind: "automixRow"; readonly queueId: string }
  | { readonly kind: "knob"; readonly label: string; readonly onReset: () => void }
  | { readonly kind: "samplerSlot"; readonly index: SlotIndex };

function deckStoreFor(deck: DeckId) {
  return deck === "a" ? useDeckAStore : useDeckBStore;
}

function loadTrackToDeck(deck: DeckId, filePath: string, fileName: string): void {
  void loadTrackMetadata(filePath, fileName)
    .then((metadata) => deckStoreFor(deck).getState().loadTrack(metadata))
    .catch((error: unknown) => {
      console.error(`Failed to load "${fileName}" to Deck ${deck.toUpperCase()}:`, error);
    });
}

const CHOKE_GROUP_LABELS: Readonly<Record<ChokeGroup, string>> = {
  0: "None",
  1: "1",
  2: "2",
  3: "3",
  4: "4",
};

export function resolveContextMenuItems(target: ContextMenuTarget): ContextMenuItem[] {
  switch (target.kind) {
    case "deck": {
      const store = deckStoreFor(target.deck).getState();
      return [
        {
          id: "clear",
          label: "Clear/Eject Track",
          onSelect: store.clearTrack,
          disabled: store.track === null,
        },
        { id: "resetPitch", label: "Reset Pitch (0%)", onSelect: () => store.setPitchPercent(0) },
        {
          id: "clearHotCues",
          label: "Clear Hot Cues",
          onSelect: store.clearAllHotCues,
          disabled: store.hotCues.length === 0,
        },
      ];
    }

    case "trackRow": {
      const { filePath, fileName } = target;
      return [
        {
          id: "loadA",
          label: "Load to Deck A",
          onSelect: () => loadTrackToDeck("a", filePath, fileName),
        },
        {
          id: "loadB",
          label: "Load to Deck B",
          onSelect: () => loadTrackToDeck("b", filePath, fileName),
        },
        {
          id: "addToAutomix",
          label: "Add to Automix",
          onSelect: () => useAutomixStore.getState().enqueue({ filePath, fileName }),
        },
        {
          id: "showInExplorer",
          label: "Show in File Explorer",
          onSelect: () => {
            void import("@tauri-apps/plugin-opener")
              .then(({ revealItemInDir }) => revealItemInDir(filePath))
              .catch((error: unknown) => {
                console.error(`Failed to reveal "${filePath}" in File Explorer:`, error);
              });
          },
        },
      ];
    }

    case "automixRow": {
      const { queueId } = target;
      const automix = useAutomixStore.getState();
      return [
        { id: "remove", label: "Remove Track", onSelect: () => automix.removeFromQueue(queueId) },
        { id: "moveTop", label: "Move to Top", onSelect: () => automix.moveToTop(queueId) },
        {
          id: "moveBottom",
          label: "Move to Bottom",
          onSelect: () => automix.moveToBottom(queueId),
        },
        {
          id: "clearQueue",
          label: "Clear Entire Queue",
          onSelect: automix.clearQueue,
          destructive: true,
        },
      ];
    }

    case "knob": {
      return [{ id: "reset", label: `Reset ${target.label}`, onSelect: target.onReset }];
    }

    case "samplerSlot": {
      const { index } = target;
      const sampler = useSamplerStore.getState();
      const slot = sampler.slots.find((entry) => entry.index === index);
      const items: ContextMenuItem[] = [
        {
          id: "clear",
          label: "Clear Slot",
          onSelect: () => sampler.clearSlot(index),
          disabled: slot?.filePath === null,
        },
      ];
      for (const group of [0, 1, 2, 3, 4] as const) {
        items.push({
          id: `choke-${group}`,
          label: `Choke Group: ${CHOKE_GROUP_LABELS[group]}`,
          onSelect: () => sampler.setChokeGroup(index, group),
          disabled: slot?.chokeGroup === group,
        });
      }
      return items;
    }
  }
}
