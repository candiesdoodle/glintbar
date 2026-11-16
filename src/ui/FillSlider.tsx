import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { clamp, cx } from "./cx";

/**
 * A Control-Center-style slider: a rounded bar that fills from the left, with an icon inside.
 * Drag or click anywhere on it; arrow keys step by 5. `onChange` fires while dragging,
 * `onCommit` once when the pointer is released.
 */
export function FillSlider({
  value,
  min = 0,
  max = 100,
  onChange,
  onCommit,
  icon,
  label,
  height = 40,
  color = "var(--g-accent)",
  className,
  trailing,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  icon?: ReactNode;
  label: string;
  height?: number;
  color?: string;
  className?: string;
  /** Shown at the right end, e.g. the percentage. */
  trailing?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const last = useRef(value);
  const frac = clamp((value - min) / (max - min || 1), 0, 1);

  const fromEvent = (e: ReactPointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return value;
    return Math.round(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min));
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={cx("relative w-full cursor-pointer touch-none overflow-hidden rounded-[14px] bg-track outline-none select-none focus-visible:ring-2 focus-visible:ring-accent", className)}
      style={{ height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setDragging(true);
        const v = fromEvent(e);
        last.current = v;
        onChange(v);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const v = fromEvent(e);
        if (v !== last.current) {
          last.current = v;
          onChange(v);
        }
      }}
      onPointerUp={() => {
        if (!dragging) return;
        setDragging(false);
        onCommit?.(last.current);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : 0;
        if (!step) return;
        e.preventDefault();
        const v = clamp(value + step, min, max);
        onChange(v);
        onCommit?.(v);
      }}
    >
      <div
        className={cx("absolute inset-y-0 left-0", !dragging && "transition-[width] duration-150")}
        style={{ width: `${frac * 100}%`, background: color }}
      />
      {icon && (
        <div className="pointer-events-none absolute inset-y-0 left-0 grid place-items-center" style={{ width: height }}>
          <span className={cx("grid place-items-center", frac > 0.12 ? "text-on-accent" : "text-dim")}>{icon}</span>
        </div>
      )}
      {trailing !== undefined && (
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] font-medium text-dim tabular-nums">{trailing}</div>
      )}
    </div>
  );
}
