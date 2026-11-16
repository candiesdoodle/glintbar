import { useId } from "react";

export interface ChartProps {
  data: number[];
  /** Fixed scale; defaults to the data's min/max. */
  min?: number;
  max?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  /** Horizontal grid lines at these values (needs min/max to be meaningful). */
  grid?: number[];
  /** Number of slots on the x axis; data is right-aligned (for "last 60 s" charts). */
  slots?: number;
}

function points(data: number[], w: number, h: number, lo: number, hi: number, slots: number): Array<[number, number]> {
  const span = hi - lo || 1;
  const n = Math.max(slots, data.length);
  const step = n > 1 ? w / (n - 1) : w;
  const offset = n - data.length;
  return data.map((v, i) => [(offset + i) * step, h - ((v - lo) / span) * h]);
}

/** SVG area chart (filled line). Scales to its container's width. */
export function AreaChart({ data, min, max, height = 64, color = "var(--g-accent)", strokeWidth = 1.5, className, grid, slots = 0, fill = true }: ChartProps & { fill?: boolean }) {
  const id = useId().replace(/:/g, "");
  const W = 100;
  const H = 100;
  if (data.length === 0) return <div className={className} style={{ height }} />;
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const pts = points(data, W, H, lo, hi, slots);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)},${H} L${pts[0][0].toFixed(2)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} style={{ height, width: "100%", display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.35} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {grid?.map((g) => {
        const y = H - ((g - lo) / (hi - lo || 1)) * H;
        return <line key={g} x1={0} x2={W} y1={y} y2={y} stroke="var(--g-track)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
      {fill && <path d={area} fill={`url(#g${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A bare line, for tiles. */
export function Sparkline(props: ChartProps) {
  return <AreaChart {...props} fill={false} />;
}
