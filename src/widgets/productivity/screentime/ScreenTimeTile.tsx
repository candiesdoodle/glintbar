import { useService } from "../../../core/backend";
import { useStored } from "../../../core/store";
import { duration } from "../../../core/format";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { DEFAULT_OPTIONS, OPTIONS_KEY, type DaySummary, type ScreenTimeConfig, type ScreenTimeOptions } from "./types";

export function HourBars({ hours, height, highlight, className }: { hours: number[]; height: number; highlight?: number; className?: string }) {
  const max = Math.max(1800, ...hours);
  return (
    <div className={"flex min-w-0 items-end gap-[2px] " + (className ?? "")} style={{ height }} aria-hidden>
      {hours.map((s, i) => (
        <div
          key={i}
          className="min-w-[2px] flex-1 rounded-[2px]"
          style={{ height: Math.max(2, (s / max) * height), background: s > 0 ? "var(--g-accent)" : "var(--g-track)", opacity: highlight === undefined || i === highlight ? 1 : s > 0 ? 0.7 : 1 }}
        />
      ))}
    </div>
  );
}

export function ScreenTimeTile({ config, size, isSample }: TileProps<ScreenTimeConfig>) {
  const day = useService<DaySummary>("productivity", "screentime_day", {}, { refreshMs: 60_000 });
  const d = day.data;
  const [opts] = useStored<ScreenTimeOptions>(OPTIONS_KEY, DEFAULT_OPTIONS);
  const pinned = config.pinned ? d?.apps.find((a) => a.key === config.pinned) : undefined;
  const big = Math.max(12, Math.round(size * 0.34));
  const small = Math.max(9, Math.round(size * 0.22));
  const unavailable = day.error && !d;
  const secs = config.pinned ? (pinned?.secs ?? 0) : (d?.totalSecs ?? 0);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.2)]" title={d ? `Screen time today: ${duration(d.totalSecs)}` : "Screen Time"}>
      {isSample && <TileSampleBadge />}
      <div className="min-w-0 shrink-0 leading-none">
        <div className="flex items-center gap-1 text-dim" style={{ fontSize: small }}>
          <span className="max-w-[90px] truncate">{d && !d.tracking && !isSample ? (opts.paused ? "Paused" : "Not counting") : config.pinned ? (pinned?.name ?? "Pinned app") : "Today"}</span>
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: big }}>
          {unavailable ? "–" : d ? duration(secs) : "…"}
        </div>
      </div>
      <HourBars hours={d?.hours ?? Array(24).fill(0)} height={Math.round(size * 0.5)} highlight={new Date().getHours()} className="flex-1" />
    </TileFrame>
  );
}
