import { Atom, Zap } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { BatteryCard, Corner, LoadingTile, NoBatteryTile, batteryTitle, shortState, useBatteryView } from "../shared/battery";
import { batteryColor, fs } from "../shared/format";

const CELLS = 12;

/** Twelve cells round a core, lit up to the charge. */
function Core({ percent, color, charging, size }: { percent: number; color: string; charging: boolean; size: number }) {
  const lit = Math.max(percent > 0 ? 1 : 0, Math.round((percent / 100) * CELLS));
  const c = size / 2;
  const cellW = Math.max(2.5, size * 0.13);
  const cellH = Math.max(3, size * 0.24);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      {Array.from({ length: CELLS }, (_, i) => (
        <rect
          key={i}
          x={c - cellW / 2}
          y={size * 0.02}
          width={cellW}
          height={cellH}
          rx={cellW * 0.35}
          transform={`rotate(${i * (360 / CELLS)} ${c} ${c})`}
          fill={i < lit ? color : "var(--g-track)"}
          style={{ transition: "fill 400ms ease" }}
        />
      ))}
      <circle cx={c} cy={c} r={size * 0.2} fill={color} fillOpacity={0.18} />
      <circle cx={c} cy={c} r={size * 0.11} fill={color} />
      {charging && (
        <foreignObject x={c - size * 0.12} y={c - size * 0.12} width={size * 0.24} height={size * 0.24}>
          <div className="grid h-full w-full place-items-center text-white">
            <Zap size={Math.round(size * 0.17)} fill="currentColor" strokeWidth={1} />
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function CoreTile({ size, isSample }: TileProps) {
  const { b, sample } = useBatteryView(isSample);
  if (!b) return <LoadingTile size={size} />;
  if (!b.present) return <NoBatteryTile size={size} />;
  const pct = b.percent ?? 0;
  const color = batteryColor(b.percent, b.charging);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={batteryTitle(b)}>
      <Core percent={pct} color={color} charging={b.charging} size={Math.round(size * 0.78)} />
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
  id: "system.battery-core",
  name: "Battery Core",
  category: "System",
  description: "Twelve segments in a circle light up with your battery level.",
  keywords: ["power", "charge", "laptop", "charging", "cells", "reactor"],
  icon: Atom,
  size: "m",
  Tile: CoreTile,
  Card: BatteryCard,
  cardSize: { width: 320 },
});
