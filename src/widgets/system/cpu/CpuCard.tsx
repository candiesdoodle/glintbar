import { Activity, Cpu } from "lucide-react";
import { call, useService, useTopic } from "../../../core/backend";
import { duration } from "../../../core/format";
import type { CardProps } from "../../../core/widget";
import { AreaChart, Button, CardFrame, ErrorState, Skeleton, Stat } from "../../../ui";
import { loadColor, type CpuInfo, type CpuSample } from "./types";

export function CpuCard(_: CardProps) {
  const sample = useTopic<CpuSample>("system", "cpu");
  const info = useService<CpuInfo>("system", "cpu_info", undefined, { refreshMs: 30_000 });
  const history = sample?.history ?? [];
  const usage = sample?.usage;
  const avg = history.length ? history.reduce((a, b) => a + b, 0) / history.length : undefined;
  const peak = history.length ? Math.max(...history) : undefined;
  const pct = (v: number | undefined) => (v === undefined ? "–" : `${Math.round(v)}%`);

  return (
    <CardFrame
      title="CPU"
      subtitle={info.data?.name ?? (info.loading ? "…" : "Processor")}
      icon={Cpu}
      footer={
        <Button size="sm" icon={Activity} onClick={() => call("shell", "open", { target: "taskmgr.exe" })}>
          Open Task Manager
        </Button>
      }
    >
      <div className="flex items-end justify-between">
        <div className="text-[34px] leading-none font-semibold tabular-nums" style={{ color: loadColor(usage) }}>
          {usage === undefined ? <Skeleton className="h-8 w-16" /> : pct(usage)}
        </div>
        <div className="text-[11px] text-faint">Last 60 seconds</div>
      </div>
      <div className="mt-3 rounded-xl bg-input px-2 py-2">
        <AreaChart data={history} min={0} max={100} slots={60} height={92} grid={[25, 50, 75]} color={loadColor(usage)} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Average" value={pct(avg)} />
        <Stat label="Peak" value={pct(peak)} />
        <Stat label="Threads" value={info.data?.logicalCores ?? "–"} />
        <Stat label="Base speed" value={info.data?.baseMhz ? `${(info.data.baseMhz / 1000).toFixed(2)} GHz` : "–"} />
        <Stat label="Up time" value={info.data ? duration(info.data.uptimeSecs) : "–"} />
      </div>
      {info.error && <ErrorState className="mt-3" message="GlintBar could not get the processor details." onRetry={info.refresh} />}
    </CardFrame>
  );
}
