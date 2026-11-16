import { Fuel } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { BatteryCard, Corner, LoadingTile, NoBatteryTile, PowerMark, batteryTitle, useBatteryView } from "../shared/battery";
import { batteryColor, fs } from "../shared/format";

/** A car fuel gauge: E on the left, F on the right, a needle for the charge. */
function FuelGauge({ percent, color, width }: { percent: number; color: string; width: number }) {
  const h = width * 0.62;
  const cx = width / 2;
  const cy = h * 0.86;
  const R = width * 0.42;
  const polar = (pct: number, r: number) => {
    const a = Math.PI - (pct / 100) * Math.PI;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number, r: number) => {
    const [x0, y0] = polar(from, r);
    const [x1, y1] = polar(to, r);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const sw = Math.max(1.5, width * 0.035);
  const angle = -90 + (Math.max(0, Math.min(100, percent)) / 100) * 180;
  const label = Math.max(7, Math.round(width * 0.14));
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <path d={arc(0, 100, R)} fill="none" stroke="var(--g-track)" strokeWidth={sw} strokeLinecap="round" />
      <path d={arc(0, 15, R)} fill="none" stroke="var(--g-bad)" strokeWidth={sw} strokeLinecap="round" />
      {[0, 25, 50, 75, 100].map((t) => {
        const [x0, y0] = polar(t, R - sw * 1.4);
        const [x1, y1] = polar(t, R - sw * (t % 50 === 0 ? 3.4 : 2.5));
        return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--g-dim)" strokeWidth={Math.max(1, sw * 0.55)} strokeLinecap="round" />;
      })}
      <text x={cx - R + sw * 0.4} y={cy + label * 0.15} fontSize={label} fontWeight={700} fill="var(--g-bad)" textAnchor="middle" dominantBaseline="hanging">
        E
      </text>
      <text x={cx + R - sw * 0.4} y={cy + label * 0.15} fontSize={label} fontWeight={700} fill="var(--g-fg)" textAnchor="middle" dominantBaseline="hanging">
        F
      </text>
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: "transform 700ms cubic-bezier(.3,1.4,.5,1)" }}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - R + sw * 1.2} stroke={color} strokeWidth={Math.max(1.5, sw * 0.8)} strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r={Math.max(2, sw * 1.1)} fill="var(--g-fg)" />
    </svg>
  );
}

function GaugeTile({ size, isSample }: TileProps) {
  const { b, sample } = useBatteryView(isSample);
  if (!b) return <LoadingTile size={size} />;
  if (!b.present) return <NoBatteryTile size={size} />;
  const pct = b.percent ?? 0;
  const color = batteryColor(b.percent, b.charging);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.12)]" title={batteryTitle(b)}>
      <FuelGauge percent={pct} color={color} width={Math.round(size * 1.02)} />
      <div className="flex min-w-0 flex-col items-start gap-[3px] leading-none">
        <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.28) }}>
          {b.percent === null ? "–" : `${pct}%`}
        </span>
        <PowerMark b={b} size={fs(size, 0.22, 9)} />
      </div>
      <Corner sample={sample} />
    </TileFrame>
  );
}

export default defineWidget({
  id: "system.battery-gauge",
  name: "Battery Gauge",
  category: "System",
  description: "Your battery level as a needle that swings between E and F.",
  keywords: ["power", "charge", "laptop", "fuel", "gauge", "needle"],
  icon: Fuel,
  size: "m",
  Tile: GaugeTile,
  Card: BatteryCard,
  cardSize: { width: 320 },
});
