import { CircleDashed } from "lucide-react";
import { useIsVisible } from "../../../core/useVisible";
import { defineWidget, type TileProps } from "../../../core/widget";
import { Ring, TileFrame } from "../../../ui";
import { BatteryCard, Corner, LoadingTile, NoBatteryTile, batteryTitle, useBatteryView } from "../shared/battery";
import { batteryColor } from "../shared/format";

function RingTile({ size, isSample }: TileProps) {
  const { b, sample } = useBatteryView(isSample);
  const visible = useIsVisible();
  if (!b) return <LoadingTile size={size} />;
  if (!b.present) return <NoBatteryTile size={size} compact />;
  const pct = b.percent ?? 0;
  const color = batteryColor(b.percent, b.charging);
  const ring = Math.round(size * 0.8);
  const stroke = Math.max(3, Math.round(ring * 0.11));
  const spark = Math.max(3, stroke + 1);
  return (
    <TileFrame padded={false} className="justify-center" title={batteryTitle(b)}>
      <div className="relative" style={{ width: ring, height: ring }}>
        <Ring value={pct} size={ring} stroke={stroke} color={color}>
          <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(ring * (pct === 100 ? 0.3 : 0.36)) }}>
            {b.percent === null ? "–" : pct}
          </span>
        </Ring>
        {b.pluggedIn && (
          // The spark: a bright dot running round the ring while plugged in (compositor-only rotation).
          <div className="g-hover-loop pointer-events-none absolute inset-0 animate-spin" style={{ animationDuration: "2.8s", animationPlayState: visible ? "running" : "paused" }}>
            <div
              className="absolute left-1/2 rounded-full"
              style={{
                top: stroke / 2 - spark / 2,
                width: spark,
                height: spark,
                marginLeft: -spark / 2,
                background: "white",
                boxShadow: `0 0 ${spark * 1.6}px ${spark * 0.5}px ${color}`,
              }}
            />
          </div>
        )}
      </div>
      <Corner sample={sample} />
    </TileFrame>
  );
}

export default defineWidget({
  id: "system.battery-ring",
  name: "Battery Ring",
  category: "System",
  description: "Battery percentage in a filling ring; a dot orbits while plugged in.",
  keywords: ["power", "charge", "laptop", "charging", "ring"],
  icon: CircleDashed,
  size: "s",
  Tile: RingTile,
  Card: BatteryCard,
  cardSize: { width: 320 },
});
