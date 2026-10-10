// Writes per-frame values (time, remaining, progress) straight into DOM nodes with
// requestAnimationFrame, so the 60 Hz status never re-renders React components.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { StatusSnapshot } from "../../ipc/types";
import { status } from "../../state/app";

/** Calls `apply(element, status)` every animation frame. */
export function useLive<E extends HTMLElement>(
  apply: (el: E, s: StatusSnapshot | null) => void,
): React.RefObject<E | null> {
  const ref = useRef<E>(null);
  const fn = useRef(apply);
  useLayoutEffect(() => {
    fn.current = apply;
  });
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      if (ref.current) fn.current(ref.current, status.get());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

/** Keeps an element's text equal to `format(status)`. */
export function useLiveText<E extends HTMLElement>(
  format: (s: StatusSnapshot | null) => string,
): React.RefObject<E | null> {
  return useLive<E>((el, s) => {
    const text = format(s);
    if (el.textContent !== text) el.textContent = text;
  });
}
