import { Activity, MemoryStick } from "lucide-react";
import { call } from "../../../core/backend";
import { bytes } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { AreaChart, Button, CardFrame, ListRow, Ring, Section, Skeleton, Stat, TileFrame } from "../../../ui";
import { loadColor } from "../cpu/types";
import { fs, mem } from "../shared/format";
import { useMemory, useProcs } from "../shared/hooks";

function RamTile({ size }: TileProps) {
  const sample = useMemory();
  const usage = sample?.usage;
  const ring = Math.round(size * 0.74);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={sample ? `Memory: ${bytes(sample.used)} used out of ${bytes(sample.total)}` : "Memory"}>
      <Ring value={usage ?? 0} size={ring} color={loadColor(usage)}>
        <MemoryStick size={Math.round(ring * 0.42)} className="text-dim" strokeWidth={2} />
      </Ring>
      <div className="min-w-0 leading-none">
        <div className="text-dim" style={{ fontSize: fs(size, 0.23, 9) }}>
          RAM
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.36) }}>
          {usage === undefined ? "–" : `${Math.round(usage)}%`}
        </div>
      </div>
    </TileFrame>
  );
}

function RamCard(_: CardProps) {
  const sample = useMemory();
  const procs = useProcs();
  const usage = sample?.usage;
  return (
    <CardFrame
      title="Memory"
      subtitle={sample ? `${bytes(sample.total)} installed` : "…"}
      icon={MemoryStick}
      footer={
        <Button size="sm" icon={Activity} onClick={() => call("shell", "open", { target: "taskmgr.exe" }).catch(() => {})}>
          Open Task Manager
        </Button>
      }
    >
      <div className="flex items-end justify-between">
        <div className="text-[34px] leading-none font-semibold tabular-nums" style={{ color: loadColor(usage) }}>
          {usage === undefined ? <Skeleton className="h-8 w-16" /> : `${Math.round(usage)}%`}
        </div>
        <div className="text-[11px] text-faint">Last 2 minutes</div>
      </div>
      <div className="mt-3 rounded-xl bg-input px-2 py-2">
        <AreaChart data={sample?.history ?? []} min={0} max={100} slots={60} height={80} grid={[25, 50, 75]} color={loadColor(usage)} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="In use" value={sample ? bytes(sample.used) : "–"} />
        <Stat label="Available" value={sample ? bytes(sample.available) : "–"} />
        <Stat label="Committed" value={sample ? bytes(sample.commitUsed) : "–"} sub={sample ? `of ${bytes(sample.commitLimit)}` : undefined} />
      </div>
      <Section title="Top apps" className="mt-4 mb-0">
        <div className="-mx-2 py-1">
          {(procs?.ram ?? []).slice(0, 5).map((a) => (
            <ListRow key={a.exe + a.name} title={a.name} subtitle={a.processes > 1 ? `${a.processes} processes` : a.exe} right={mem(a.memory)} />
          ))}
          {!procs && <div className="px-2 py-2 text-[12px] text-dim">Loading app list…</div>}
        </div>
      </Section>
    </CardFrame>
  );
}

export default defineWidget({
  id: "system.ram",
  name: "RAM",
  category: "System",
  description: "RAM use in a ring; open it for a 2-minute chart and top apps.",
  keywords: ["memory", "ram", "usage", "performance", "task manager"],
  icon: MemoryStick,
  size: "m",
  Tile: RamTile,
  Card: RamCard,
  cardSize: { width: 340 },
});
