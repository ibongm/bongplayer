import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUIStore } from "../../store/useUIStore";
import { resolveContextMenuItems } from "./contextMenuTargets";

const VIEWPORT_MARGIN_PX = 8;

function focusableButtons(menuElement: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    menuElement.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'),
  );
}

/**
 * Renders the app's single active context menu (AGENTS §2.2: global
 * right-click handler with boundary-aware positioning; Risk #7: focus
 * management — the menu takes focus on open, Up/Down/Home/End navigate
 * its items, and focus returns to whatever triggered it on close). Mount
 * this once near the app root; individual controls open a menu via
 * useUIStore.getState().openContextMenu({x, y, target}).
 */
export function ContextMenu() {
  const menu = useUIStore((state) => state.activeContextMenu);
  const closeContextMenu = useUIStore((state) => state.closeContextMenu);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Suppress the native OS context menu everywhere in the app — components
  // opt in to a custom menu explicitly via openContextMenu(); right-clicking
  // anything else just does nothing, rather than showing the browser's menu.
  useEffect(() => {
    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Remember what had focus before the menu opened, and restore it on close.
  useEffect(() => {
    if (menu === null) {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
      return;
    }
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [menu]);

  useEffect(() => {
    if (menu === null) return;

    function onPointerDown(event: MouseEvent): void {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        closeContextMenu();
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (menuRef.current === null) return;
      if (event.key === "Escape") {
        closeContextMenu();
        return;
      }
      const buttons = focusableButtons(menuRef.current);
      if (buttons.length === 0) return;
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        buttons[(currentIndex + 1) % buttons.length].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        buttons[(currentIndex - 1 + buttons.length) % buttons.length].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        buttons[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, closeContextMenu]);

  useLayoutEffect(() => {
    if (menu === null || menuRef.current === null) {
      setCoords(null);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(
      window.innerWidth - rect.width - VIEWPORT_MARGIN_PX,
      VIEWPORT_MARGIN_PX,
    );
    const maxTop = Math.max(
      window.innerHeight - rect.height - VIEWPORT_MARGIN_PX,
      VIEWPORT_MARGIN_PX,
    );
    setCoords({
      left: Math.min(Math.max(menu.x, VIEWPORT_MARGIN_PX), maxLeft),
      top: Math.min(Math.max(menu.y, VIEWPORT_MARGIN_PX), maxTop),
    });
    focusableButtons(menuRef.current)[0]?.focus();
  }, [menu]);

  if (menu === null) return null;

  const items = resolveContextMenuItems(menu.target);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Actions"
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        visibility: coords !== null ? "visible" : "hidden",
      }}
      className="z-50 min-w-48 rounded-md border border-white/10 bg-surfaceRaised/90 py-1 text-sm text-textPrimary shadow-xl backdrop-blur-md"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            closeContextMenu();
          }}
          className={`block w-full px-3 py-1.5 text-left hover:bg-accent/20 focus-visible:bg-accent/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
            item.destructive === true ? "text-red-400" : ""
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
