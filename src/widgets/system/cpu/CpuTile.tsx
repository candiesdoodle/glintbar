import { Cpu } from "lucide-react";
import { useTopic } from "../../../core/backend";
import type { TileProps } from "../../../core/widget";
import { Ring, TileFrame } from "../../../ui";
import { loadColor, type CpuSample } from "./types";

export function CpuTile({ size }: TileProps) {
  // Subscribes only while this tile is visible; Rust samples only while someone subscribes.
  const sample = useTopic<CpuSample>("system", "cpu");
  const usage = sample?.usage;
  const ring = Math.round(size * 0.74);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title="CPU load">
      <Ring value={usage ?? 0} size={ring} color={loadColor(usage)}>
        <Cpu size={Math.round(ring * 0.42)} className="text-dim" strokeWidth={2} />
      </Ring>
      <div className="min-w-0 leading-none">
        <div className="text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.23)) }}>
          CPU
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.36) }}>
          {usage === undefined ? "–" : `${Math.round(usage)}%`}
        </div>
      </div>
    </TileFrame>
  );
}
