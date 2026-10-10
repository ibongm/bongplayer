// Linear fader (vertical channel / pitch faders, horizontal crossfader).
// Drag the track, mouse wheel, or arrow keys when focused. Right-click or double-click resets.

import { useRef, type ReactNode } from "react";

export interface FaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: string;
  orientation: "vertical" | "horizontal";
  /** Length of the track in pixels. */
  length: number;
  /** For vertical faders: value grows downwards (pitch faders: + at the bottom). */
  invert?: boolean;
  steps?: number;
  /** Show a centre detent mark. */
  centreMark?: boolean;
}

export function Fader({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  format,
  hint,
  orientation,
  length,
  invert = false,
  steps = 100,
  centreMark = false,
}: FaderProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const range = max - min;
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));
  const vertical = orientation === "vertical";
  let t = (value - min) / range;
  if (vertical && !invert) t = 1 - t;
  const cap = 18;

  const fromPointer = (clientX: number, clientY: number): number => {
    const el = ref.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const span = (vertical ? r.height : r.width) - cap;
    if (span <= 0) return value;
    let f = vertical ? (clientY - r.top - cap / 2) / span : (clientX - r.left - cap / 2) / span;
    f = Math.max(0, Math.min(1, f));
    if (vertical && !invert) f = 1 - f;
    return clamp(min + f * range);
  };

  return (
    <div className={`flex items-center gap-1 ${vertical ? "flex-col" : "flex-row"}`}>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        title={`${label}: ${format(value)} — drag, wheel or arrow keys; right-click resets${hint ? ` · ${hint}` : ""}`}
        className="relative rounded bg-bg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        style={vertical ? { width: 22, height: length } : { width: length, height: 22 }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
          onChange(fromPointer(e.clientX, e.clientY));
          const move = (ev: PointerEvent): void => {
            onChange(fromPointer(ev.clientX, ev.clientY));
          };
          const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        onWheel={(e) => {
          const dir = vertical && invert ? 1 : -1;
          onChange(clamp(value + dir * Math.sign(e.deltaY) * (range / steps)));
        }}
        onDoubleClick={() => {
          onChange(defaultValue);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onChange(defaultValue);
        }}
        onKeyDown={(e) => {
          const step = range / steps;
          const up = vertical && invert ? -1 : 1;
          let v: number | null = null;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") v = value + step * up;
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") v = value - step * up;
          else if (e.key === "PageUp") v = value + step * 10 * up;
          else if (e.key === "PageDown") v = value - step * 10 * up;
          else if (e.key === "Home") v = min;
          else if (e.key === "End") v = max;
          else if (e.key === "Delete" || e.key === "Backspace") v = defaultValue;
          if (v === null) return;
          e.preventDefault();
          onChange(clamp(v));
        }}
      >
        <div
          className="absolute rounded bg-border"
          style={vertical ? { left: 10, top: 4, width: 2, bottom: 4 } : { top: 10, left: 4, height: 2, right: 4 }}
        />
        {centreMark && (
          <div
            className="absolute bg-muted"
            style={vertical ? { left: 4, right: 4, top: length / 2 - 0.5, height: 1 } : { top: 4, bottom: 4, left: length / 2 - 0.5, width: 1 }}
          />
        )}
        <div
          className="absolute rounded-sm border border-border bg-surface-raised shadow"
          style={
            vertical
              ? { left: 1, width: 20, height: cap, top: t * (length - cap) }
              : { top: 1, height: 20, width: cap, left: t * (length - cap) }
          }
        >
          <div className={`absolute bg-accent ${vertical ? "top-1/2 right-1 left-1 h-0.5" : "top-1 bottom-1 left-1/2 w-0.5"}`} />
        </div>
      </div>
      <span className="text-[11px] leading-none text-muted">{label}</span>
    </div>
  );
}
