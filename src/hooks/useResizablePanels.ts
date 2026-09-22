import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useUIStore, type PanelRatios } from "../store/useUIStore";

export const MIN_LEFT_PX = 160;
export const MIN_RIGHT_PX = 220;
const MIN_CENTER_RATIO = 0.1;

export type SplitterId = "left" | "right";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Pure ratio math for dragging one splitter, decoupled from the DOM/pointer
 * wiring below so it's directly unit-testable. Dragging "left" moves the
 * left/center boundary (right stays fixed); dragging "right" moves the
 * center/right boundary (left stays fixed).
 */
export function computeDraggedRatios(
  splitter: SplitterId,
  startRatios: PanelRatios,
  deltaRatio: number,
  minLeftRatio: number,
  minRightRatio: number,
  minCenterRatio: number = MIN_CENTER_RATIO,
): PanelRatios {
  let { left, right } = startRatios;
  if (splitter === "left") {
    const maxLeft = Math.max(minLeftRatio, 1 - minCenterRatio - right);
    left = clamp(startRatios.left + deltaRatio, minLeftRatio, maxLeft);
  } else {
    const maxRight = Math.max(minRightRatio, 1 - minCenterRatio - left);
    right = clamp(startRatios.right - deltaRatio, minRightRatio, maxRight);
  }
  return { left, center: 1 - left - right, right };
}

export interface UseResizablePanelsResult {
  readonly ratios: PanelRatios;
  beginDrag(splitter: SplitterId, clientX: number): void;
  resetRatios(): void;
}

/** Drives the 3-column dock's splitters, persisted via useUIStore's panelRatios (AGENTS §3, hooks/useResizablePanels.ts). */
export function useResizablePanels(
  containerRef: RefObject<HTMLElement | null>,
): UseResizablePanelsResult {
  const ratios = useUIStore((state) => state.panelRatios);
  const setPanelRatios = useUIStore((state) => state.setPanelRatios);
  const resetPanelRatios = useUIStore((state) => state.resetPanelRatios);

  // Holds the cleanup for whichever drag is currently in progress, if any —
  // a ref rather than useCallback state, since onPointerMove/onPointerUp are
  // created fresh per drag (closing over that drag's own start position) and
  // would otherwise have no stable identity to reference for "stop the
  // previous drag" or unmount cleanup.
  const stopDragRef = useRef<() => void>(() => {});

  const beginDrag = useCallback(
    (splitter: SplitterId, clientX: number) => {
      stopDragRef.current();

      const startX = clientX;
      const startRatios = ratios;

      function onPointerMove(event: PointerEvent): void {
        const container = containerRef.current;
        if (container === null) return;
        const width = container.clientWidth;
        if (width <= 0) return;
        const deltaRatio = (event.clientX - startX) / width;
        setPanelRatios(
          computeDraggedRatios(
            splitter,
            startRatios,
            deltaRatio,
            MIN_LEFT_PX / width,
            MIN_RIGHT_PX / width,
          ),
        );
      }

      function onPointerUp(): void {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        stopDragRef.current = () => {};
      }

      stopDragRef.current = onPointerUp;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [ratios, containerRef, setPanelRatios],
  );

  useEffect(() => () => stopDragRef.current(), []);

  return { ratios, beginDrag, resetRatios: resetPanelRatios };
}
