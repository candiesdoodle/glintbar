import type { CSSProperties, ReactNode } from "react";
import "./motion.css";
import { clamp } from "./cx";

/** A half-circle gauge (speedometer). Width = `size`, height ≈ size/2 + stroke. */
export function Gauge({
  value,
  max = 100,
  size,
  stroke = Math.max(3, Math.round(size * 0.1)),
  color = "var(--g-accent)",
  track = "var(--g-track)",
  children,
}: {
  value: number;
  max?: number;
  size: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const cy = size / 2;
  const d = `M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`;
  const len = Math.PI * r;
  const frac = max > 0 ? clamp(value / max, 0, 1) : 0;
  const h = size / 2 + stroke / 2;
  return (
    <div className="relative inline-block shrink-0" style={{ width: size, height: h }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} aria-hidden>
        <path d={d} fill="none" stroke={track} strokeWidth={stroke} strokeLinecap="round" />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
          className="g-glide"
          style={{ "--g-glide": "stroke-dashoffset 450ms ease" } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 grid place-items-center leading-none">{children}</div>
    </div>
  );
}
