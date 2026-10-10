// Rotary knob. Drag up/down (Shift = fine), mouse wheel, or ↑/↓ / PgUp/PgDn when focused.
// Right-click or double-click resets to the default value.

import { useRef, type ReactNode } from "react";

export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (v: number) => void;
  /** Value shown in the tooltip, e.g. "−6.0 dB". */
  format: (v: number) => string;
  /** Extra tooltip text (shortcut). */
  hint?: string;
  size?: number;
  /** Draw the arc from the centre (bipolar knobs: EQ, filter). */
  bipolar?: boolean;
  /** Steps per arrow key press across the whole range. */
  steps?: number;
}

export function Knob({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  format,
  hint,
  size = 40,
  bipolar = false,
  steps = 50,
}: KnobProps): ReactNode {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const range = max - min;
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));
  const t = (value - min) / range;
  const angle = -135 + 270 * t;
  const r = size / 2 - 4;
  const c = size / 2;
  const polar = (deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const arc = (from: number, to: number): string => {
    const [x1, y1] = polar(from);
    const [x2, y2] = polar(to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  };
  const start = bipolar ? 0 : -135;
  const [px, py] = polar(angle);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        title={`${label}: ${format(value)} — drag or wheel, ↑/↓ when focused; right-click resets${hint ? ` · ${hint}` : ""}`}
        className="cursor-ns-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
          drag.current = { y: e.clientY, v: value };
          const move = (ev: PointerEvent): void => {
            if (!drag.current) return;
            const fine = ev.shiftKey ? 0.2 : 1;
            const dv = ((drag.current.y - ev.clientY) / 150) * range * fine;
            onChange(clamp(drag.current.v + dv));
          };
          const up = (): void => {
            drag.current = null;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        onWheel={(e) => {
          onChange(clamp(value - Math.sign(e.deltaY) * (range / steps)));
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
          let v: number | null = null;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") v = value + step;
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") v = value - step;
          else if (e.key === "PageUp") v = value + step * 5;
          else if (e.key === "PageDown") v = value - step * 5;
          else if (e.key === "Home") v = min;
          else if (e.key === "End") v = max;
          else if (e.key === "Delete" || e.key === "Backspace" || e.key === "0") v = defaultValue;
          if (v === null) return;
          e.preventDefault();
          onChange(clamp(v));
        }}
      >
        <svg width={size} height={size} aria-hidden="true">
          <path d={arc(-135, 135)} fill="none" stroke="var(--color-border)" strokeWidth={3} strokeLinecap="round" />
          {Math.abs(angle - start) > 0.5 && (
            <path
              d={arc(Math.min(start, angle), Math.max(start, angle))}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
          <circle cx={c} cy={c} r={r - 5} fill="var(--color-surface-raised)" />
          <line x1={c} y1={c} x2={px} y2={py} stroke="var(--color-text)" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-[11px] leading-none text-muted">{label}</span>
    </div>
  );
}
