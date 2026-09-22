export interface SplitterHandleProps {
  readonly onDragStart: (clientX: number) => void;
  readonly onReset: () => void;
}

/** Draggable column divider; double-click resets to the default 20/55/25 split (AGENTS §5). */
export function SplitterHandle({ onDragStart, onReset }: SplitterHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={(event) => onDragStart(event.clientX)}
      onDoubleClick={onReset}
      className="relative w-1.5 shrink-0 cursor-col-resize bg-white/5 hover:bg-accent/40"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
