// Our own context menu (the browser's cannot have custom items or hover submenus).
// Mouse: hover opens a submenu; moving to another item closes it; click selects.
// Keyboard: ↑/↓ move, → or Enter opens a submenu, ← or Esc closes it, Enter selects, Esc closes.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createStore, useStore } from "../state/store";

export interface MenuItem {
  id: string;
  label: string;
  /** Shown on the right, e.g. "Ctrl+A". */
  shortcut?: string;
  disabled?: boolean;
  /** Draw a line above this item. */
  separator?: boolean;
  danger?: boolean;
  onSelect?: () => void;
  submenu?: MenuItem[];
}

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
  /** Element to give focus back to when the menu closes. */
  returnFocus: HTMLElement | null;
}

export const menuStore = createStore<OpenMenu | null>(null);

export function openMenu(x: number, y: number, items: MenuItem[]): void {
  const active = document.activeElement;
  menuStore.set({
    x,
    y,
    items,
    returnFocus: active instanceof HTMLElement ? active : null,
  });
}

export function closeMenu(): void {
  const m = menuStore.get();
  menuStore.set(null);
  m?.returnFocus?.focus();
}

function firstEnabled(items: MenuItem[], from: number, step: 1 | -1): number {
  const n = items.length;
  for (let i = 0; i < n; i++) {
    const idx = (((from + step * i) % n) + n) % n;
    if (!items[idx]?.disabled) return idx;
  }
  return -1;
}

interface PanelProps {
  items: MenuItem[];
  x: number;
  y: number;
  depth: number;
  /** Closes this panel (submenu) and returns focus to the parent item. */
  onBack?: () => void;
  autoFocusFirst: boolean;
}

function MenuPanel({ items, x, y, depth, onBack, autoFocusFirst }: PanelProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(autoFocusFirst ? firstEnabled(items, 0, 1) : -1);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subAnchor, setSubAnchor] = useState<{ x: number; y: number } | null>(null);
  const [subFocus, setSubFocus] = useState(false);
  const [pos, setPos] = useState({ x, y });
  const closeTimer = useRef<number | null>(null);

  // Keep the panel inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxX = window.innerWidth - r.width - 4;
    const maxY = window.innerHeight - r.height - 4;
    setPos({ x: Math.max(4, Math.min(x, maxX)), y: Math.max(4, Math.min(y, maxY)) });
  }, [x, y]);

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.focus();
  }, [active]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openSubmenu = (i: number, focusInside: boolean): void => {
    cancelClose();
    const r = itemRefs.current[i]?.getBoundingClientRect();
    setSubAnchor(r ? { x: r.right - 2, y: r.top - 4 } : { x: pos.x + 200, y: pos.y });
    setOpenSub(i);
    setSubFocus(focusInside);
  };

  const select = (item: MenuItem, i: number): void => {
    if (item.disabled) return;
    if (item.submenu) {
      openSubmenu(i, true);
      return;
    }
    closeMenu();
    item.onSelect?.();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Keys typed inside an open submenu are handled there.
    if (openSub !== null && subFocus) return;
    const item = items[active];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive(firstEnabled(items, active + 1, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(firstEnabled(items, active < 0 ? items.length - 1 : active - 1, -1));
        break;
      case "ArrowRight":
        e.preventDefault();
        if (item?.submenu && !item.disabled) openSubmenu(active, true);
        break;
      case "ArrowLeft":
        e.preventDefault();
        onBack?.();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (item) select(item, active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (onBack) onBack();
        else closeMenu();
        break;
      case "Tab":
        e.preventDefault();
        break;
    }
  };

  const sub = openSub !== null ? items[openSub] : undefined;

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={depth === 0 ? "Context menu" : "Submenu"}
        data-menu-depth={depth}
        className="fixed z-50 min-w-56 rounded-md border border-border bg-surface-raised py-1 text-[13px] shadow-xl"
        style={{ left: pos.x, top: pos.y }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        {items.map((item, i) => (
          <div key={item.id}>
            {item.separator && <div className="my-1 border-t border-border" role="separator" />}
            <button
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled === true}
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? openSub === i : undefined}
              tabIndex={active === i ? 0 : -1}
              className={`flex w-full items-center gap-4 px-3 py-1.5 text-left outline-none ${
                item.disabled
                  ? "cursor-default text-muted opacity-60"
                  : active === i
                    ? "bg-accent/20"
                    : ""
              } ${item.danger && !item.disabled ? "text-danger" : ""}`}
              onMouseEnter={() => {
                setActive(i);
                if (item.submenu && !item.disabled) openSubmenu(i, false);
                else if (openSub !== null) {
                  cancelClose();
                  closeTimer.current = window.setTimeout(() => {
                    setOpenSub(null);
                  }, 150);
                }
              }}
              onClick={() => {
                select(item, i);
              }}
            >
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <span className="text-[11px] text-muted">{item.shortcut}</span>}
              {item.submenu && <span aria-hidden="true">▸</span>}
            </button>
          </div>
        ))}
      </div>
      {sub?.submenu && subAnchor && (
        <div onMouseEnter={cancelClose}>
          <MenuPanel
            key={sub.id}
            items={sub.submenu}
            x={subAnchor.x}
            y={subAnchor.y}
            depth={depth + 1}
            autoFocusFirst={subFocus}
            onBack={() => {
              setOpenSub(null);
              setSubFocus(false);
              itemRefs.current[openSub ?? 0]?.focus();
            }}
          />
        </div>
      )}
    </>
  );
}

/** Renders the open context menu (once, near the root of the app). */
export function ContextMenuHost(): ReactNode {
  const menu = useStore(menuStore, (m) => m);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target;
      if (t instanceof Element && t.closest('[role="menu"]')) return;
      closeMenu();
    };
    const onBlur = (): void => {
      closeMenu();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [menu]);

  if (!menu) return null;
  return createPortal(
    <MenuPanel items={menu.items} x={menu.x} y={menu.y} depth={0} autoFocusFirst />,
    document.body,
  );
}
