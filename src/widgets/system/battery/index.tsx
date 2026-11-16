import { BatteryMedium, Zap } from "lucide-react";
import { useId } from "react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { BatteryCard, Corner, LoadingTile, NoBatteryTile, batteryTitle, shortState, useBatteryView } from "../shared/battery";
import { batteryColor, fs } from "../shared/format";

/** A battery outline filled with "water" up to the charge. */
export function WaterBattery({ percent, color, charging, width, height }: { percent: number; color: string; charging: boolean; width: number; height: number }) {
  const id = useId().replace(/:/g, "");
  const nub = Math.max(2, Math.round(width * 0.07));
  const bw = width - nub - 1;
  const r = Math.max(3, height * 0.22);
  const inset = 2.5;
  const innerH = height - inset * 2;
  const level = inset + innerH * (1 - Math.max(0, Math.min(100, percent)) / 100);
  const amp = Math.min(2.2, innerH * 0.08);
  const wave = (phase: number) => {
    const n = 4;
    const seg = (bw - inset * 2) / n;
    let d = `M${inset},${level}`;
    for (let i = 0; i < n; i++) {
      const x0 = inset + i * seg;
      const dir = (i + phase) % 2 === 0 ? -1 : 1;
      d += ` Q${x0 + seg / 2},${level + dir * amp} ${x0 + seg},${level}`;
    }
    return `${d} L${bw - inset},${height} L${inset},${height} Z`;
  };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible" aria-hidden>
      <defs>
        <clipPath id={`b${id}`}>
          <rect x={inset} y={inset} width={bw - inset * 2} height={innerH} rx={Math.max(1.5, r - inset)} />
        </clipPath>
      </defs>
      <rect x={0.75} y={0.75} width={bw - 1.5} height={height - 1.5} rx={r} fill="none" stroke="var(--g-dim)" strokeOpacity={0.55} strokeWidth={1.5} />
      <rect x={bw + 0.5} y={height * 0.32} width={nub} height={height * 0.36} rx={1.2} fill="var(--g-dim)" fillOpacity={0.55} />
      <g clipPath={`url(#b${id})`}>
        <rect x={0} y={0} width={bw} height={height} fill="var(--g-track)" />
        <path d={wave(1)} fill={color} fillOpacity={0.35} style={{ transition: "d 600ms ease" }} />
        <path d={wave(0)} fill={color} transform={`translate(0 ${amp * 0.9})`} style={{ transition: "d 600ms ease" }} />
      </g>
      {charging && (
        <foreignObject x={0} y={0} width={bw} height={height}>
          <div className="grid h-full w-full place-items-center">
            <Zap size={Math.round(height * 0.62)} className="text-white drop-shadow" fill="currentColor" strokeWidth={1} />
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function BatteryTile({ size, isSample }: TileProps) {
  const { b, sample } = useBatteryView(isSample);
  if (!b) return <LoadingTile size={size} />;
  if (!b.present) return <NoBatteryTile size={size} />;
  const pct = b.percent ?? 0;
  const color = batteryColor(b.percent, b.charging);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={batteryTitle(b)}>
      <WaterBattery percent={pct} color={color} charging={b.charging} width={Math.round(size * 0.74)} height={Math.round(size * 0.44)} />
      <div className="min-w-0 leading-none">
        <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.34) }}>
          {b.percent === null ? "–" : `${pct}%`}
        </div>
        {size >= 40 && (
          <div className="mt-[3px] truncate text-dim" style={{ fontSize: fs(size, 0.19, 8) }}>
            {shortState(b)}
          </div>
        )}
      </div>
      <Corner sample={sample} />
    </TileFrame>
  );
}

export default defineWidget({
  id: "system.battery",
  name: "Battery",
  category: "System",
  description: "Battery level as water in a battery outline, with a charging bolt.",
  keywords: ["power", "charge", "laptop", "charging", "energy"],
  icon: BatteryMedium,
  size: "m",
  Tile: BatteryTile,
  Card: BatteryCard,
  cardSize: { width: 320 },
});
