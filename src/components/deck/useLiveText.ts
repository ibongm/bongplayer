// Writes per-frame values (time, remaining) straight into DOM nodes with requestAnimationFrame,
// so the 60 Hz status never re-renders React components.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { StatusSnapshot } from "../../ipc/types";
import { status } from "../../state/app";

export function useLiveText<E extends HTMLElement>(
  format: (s: StatusSnapshot | null) => string,
): React.RefObject<E | null> {
  const ref = useRef<E>(null);
  const fmt = useRef(format);
  useLayoutEffect(() => {
    fmt.current = format;
  });
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = (): void => {
      const text = fmt.current(status.get());
      if (text !== last && ref.current) {
        ref.current.textContent = text;
        last = text;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}
