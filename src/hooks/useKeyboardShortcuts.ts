import { useEffect } from "react";
import { useDeckController } from "./useDeckController";
import { useDeckAStore } from "../store/useDeckAStore";
import { useDeckBStore } from "../store/useDeckBStore";
import { useUIStore } from "../store/useUIStore";
import { activateHotCue } from "../services/padActions";
import { isTypingTarget, resolveShortcut } from "../services/keyboardShortcuts";
import type { DeckId } from "../types/deck";

/** Installs the global DJ-standard keymap (AGENTS §3/Risk #7). Mount once near the app root. */
export function useKeyboardShortcuts(): void {
  const deckAController = useDeckController("a");
  const deckBController = useDeckController("b");

  useEffect(() => {
    function controllerFor(deck: DeckId) {
      return deck === "a" ? deckAController : deckBController;
    }
    function storeFor(deck: DeckId) {
      return deck === "a" ? useDeckAStore : useDeckBStore;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      const action = resolveShortcut(event);
      if (action === null) return;
      event.preventDefault();

      switch (action.kind) {
        case "deckPlayPause": {
          const controller = controllerFor(action.deck);
          const store = storeFor(action.deck);
          if (store.getState().playbackState === "playing") {
            controller.pause();
          } else {
            controller.play();
          }
          return;
        }
        case "deckCue": {
          controllerFor(action.deck).stop();
          return;
        }
        case "deckHotCue": {
          activateHotCue(action.deck, action.index);
          return;
        }
        case "toggleShiftLock": {
          useUIStore.getState().toggleShiftLock();
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deckAController, deckBController]);
}
