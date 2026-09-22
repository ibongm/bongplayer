import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  readonly text: string;
  readonly shortcut?: string;
  readonly children: ReactNode;
  readonly delayMs?: number;
}

const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 8;
const DEFAULT_DELAY_MS = 150;

/** Wraps any control with a viewport-aware, glassmorphic tooltip (AGENTS §2.1: 150ms delay). */
export function Tooltip({ text, shortcut, children, delayMs = DEFAULT_DELAY_MS }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<number | null>(null);

  function clearScheduled(): void {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function scheduleOpen(): void {
    clearScheduled();
    timeoutRef.current = window.setTimeout(() => setOpen(true), delayMs);
  }

  function close(): void {
    clearScheduled();
    setOpen(false);
    setCoords(null);
  }

  useEffect(() => clearScheduled, []);

  useLayoutEffect(() => {
    if (!open || anchorRef.current === null || tooltipRef.current === null) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let top = anchorRect.top - tooltipRect.height - ANCHOR_GAP_PX;
    if (top < VIEWPORT_MARGIN_PX) {
      top = anchorRect.bottom + ANCHOR_GAP_PX; // not enough room above — flip below
    }

    const idealLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(
      window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN_PX,
      VIEWPORT_MARGIN_PX,
    );
    const left = Math.min(Math.max(idealLeft, VIEWPORT_MARGIN_PX), maxLeft);

    setCoords({ top, left });
  }, [open, text, shortcut]);

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={scheduleOpen}
      onBlur={close}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              visibility: coords !== null ? "visible" : "hidden",
            }}
            className="pointer-events-none z-50 flex items-center gap-2 rounded-md border border-white/10 bg-surfaceRaised/80 px-2.5 py-1.5 text-xs whitespace-nowrap text-textPrimary shadow-lg backdrop-blur-md"
          >
            <span>{text}</span>
            {shortcut !== undefined && (
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-textMuted">
                {shortcut}
              </kbd>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
