import { useEffect, useRef } from "react";
import { useDeckAStore } from "../../store/useDeckAStore";
import { useDeckBStore } from "../../store/useDeckBStore";
import { useDeckController } from "../../hooks/useDeckController";
import type { DeckId } from "../../types/deck";

export interface JogWheelProps {
  readonly deck: DeckId;
}

const RPM = 33 + 1 / 3;
const DEGREES_PER_SECOND = (RPM / 60) * 360;
const SECONDS_PER_REVOLUTION = 60 / RPM;

function angleFromCenter(centerX: number, centerY: number, x: number, y: number): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}

/** Continuous 33⅓ RPM platter rotation + touch/pointer scrubbing (AGENTS §3, deck/JogWheel.tsx). */
export function JogWheel({ deck }: JogWheelProps) {
  const store = deck === "a" ? useDeckAStore : useDeckBStore;
  const controller = useDeckController(deck);
  const playbackState = store((state) => state.playbackState);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const needleRef = useRef<HTMLDivElement | null>(null);
  const rotationDegRef = useRef(0);
  const lastFrameTimeRef = useRef<number | null>(null);
  const dragRef = useRef<{ centerX: number; centerY: number; lastAngle: number } | null>(null);

  // Direct-DOM rAF rotation — mutating refs (transform + the ARIA value)
  // avoids a 60fps React re-render, which subscribing to currentTimeSeconds
  // here would otherwise force.
  useEffect(() => {
    let frameId: number;
    function tick(now: number): void {
      if (
        lastFrameTimeRef.current !== null &&
        playbackState === "playing" &&
        dragRef.current === null
      ) {
        const deltaSeconds = (now - lastFrameTimeRef.current) / 1000;
        rotationDegRef.current = (rotationDegRef.current + DEGREES_PER_SECOND * deltaSeconds) % 360;
        if (needleRef.current !== null) {
          needleRef.current.style.transform = `rotate(${rotationDegRef.current}deg)`;
        }
      }
      lastFrameTimeRef.current = now;
      if (containerRef.current !== null) {
        containerRef.current.setAttribute(
          "aria-valuenow",
          store.getState().currentTimeSeconds.toFixed(1),
        );
      }
      frameId = requestAnimationFrame(tick);
    }
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playbackState, store]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    dragRef.current = {
      centerX,
      centerY,
      lastAngle: angleFromCenter(centerX, centerY, event.clientX, event.clientY),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (drag === null) return;

    const angle = angleFromCenter(drag.centerX, drag.centerY, event.clientX, event.clientY);
    let deltaAngle = angle - drag.lastAngle;
    if (deltaAngle > 180) deltaAngle -= 360;
    if (deltaAngle < -180) deltaAngle += 360;
    drag.lastAngle = angle;

    rotationDegRef.current = (rotationDegRef.current + deltaAngle + 360) % 360;
    if (needleRef.current !== null) {
      needleRef.current.style.transform = `rotate(${rotationDegRef.current}deg)`;
    }

    const deltaSeconds = (deltaAngle / 360) * SECONDS_PER_REVOLUTION;
    controller.seek(store.getState().currentTimeSeconds + deltaSeconds);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  const KEYBOARD_NUDGE_SECONDS = 0.5;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      controller.seek(store.getState().currentTimeSeconds - KEYBOARD_NUDGE_SECONDS);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      controller.seek(store.getState().currentTimeSeconds + KEYBOARD_NUDGE_SECONDS);
    }
  }

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label={`Deck ${deck.toUpperCase()} jog wheel`}
      aria-valuemin={0}
      aria-valuemax={store.getState().track?.duration ?? 0}
      aria-valuenow={store.getState().currentTimeSeconds}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className="relative aspect-square w-full max-w-[220px] shrink-0 cursor-grab touch-none rounded-full border-4 border-white/10 bg-surfaceRaised select-none focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
    >
      <div ref={needleRef} className="absolute inset-0 origin-center">
        <div className="absolute top-2 left-1/2 h-1/3 w-0.5 -translate-x-1/2 bg-accent" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center text-xs text-textMuted">
        {deck.toUpperCase()}
      </div>
    </div>
  );
}
