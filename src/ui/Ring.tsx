import type { CSSProperties, ReactNode } from "react";
import "./motion.css";
import { clamp } from "./cx";

/** A progress ring. `value` of `max`; colours default to the theme accent and track. */
export function Ring({
  value,
  max = 100,
  size,
  stroke = Math.max(3, Math.round(size * 0.11)),
  color = "var(--g-accent)",
  track = "var(--g-track)",
  children,
  className,
}: {
  value: number;
  max?: number;
  size: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? clamp(value / max, 0, 1) : 0;
  return (
    <div className={"relative inline-grid shrink-0 place-items-center " + (className ?? "")} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="g-glide"
          style={{ "--g-glide": "stroke-dashoffset 450ms ease, stroke 300ms ease" } as CSSProperties}
        />
      </svg>
      <div className="relative grid place-items-center leading-none">{children}</div>
    </div>
  );
}
