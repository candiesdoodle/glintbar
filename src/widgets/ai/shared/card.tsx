/** Card building blocks shared by the AI widgets: limit blocks with the usage chart, plan lines, status. */
import { useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { call } from "../../../core/backend";
import { describeError } from "../../../core/http";
import { relativeTime } from "../../../core/format";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import { Button, CardFrame, ErrorState, IconButton, ProgressBar, Section, SampleBadge, Skeleton, cx } from "../../../ui";
import { pct, resetAt, resetIn, resetLine, usageColor } from "./format";
import { historyKey, useHistory, type Point } from "./history";
import { project } from "./projection";
import { TOOLS } from "./tools";
import { Glyph, isOffline } from "./ui";
import type { AiLimit, ToolId, ToolReading } from "./types";
import type { View } from "./data";

const W = 300;
const H = 64;

/** Axis label: the time for windows up to a day, the weekday and date for longer ones. */
function shortWhen(t: number, windowMs: number, hour24: boolean): string {
  const d = new Date(t);
  if (windowMs <= 86_400_000) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: !hour24 });
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: windowMs > 8 * 86_400_000 ? "short" : undefined });
}

/**
 * How the window was used so far (solid), and where it is headed by the reset at the same pace
 * (dashed). Turns red where the pace would run out before the reset.
 */
export function UsageChart({ limit, points, now }: { limit: AiLimit; points: Point[]; now: number }) {
  const hour24 = useSettings((s) => s.clock24h);
  if (!limit.resetsAt || !limit.windowMs) return null;
  const end = limit.resetsAt;
  const start = end - limit.windowMs;
  const x = (t: number) => ((Math.min(end, Math.max(start, t)) - start) / limit.windowMs!) * W;
  const y = (p: number) => H - (Math.min(100, Math.max(0, p)) / 100) * (H - 2) - 1;
  const used = [[start, 0] as Point, ...points.filter(([t]) => t > start && t < now).sort((a, b) => a[0] - b[0]), [now, limit.usedPct] as Point];
  // Never let the line go down inside one window (readings can arrive out of order).
  let max = 0;
  const mono = used.map(([t, p]) => {
    max = Math.max(max, p);
    return [t, max] as Point;
  });
  const line = mono.map(([t, p], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = `${line} L${x(now).toFixed(1)},${H} L0,${H} Z`;
  const proj = project(limit, now);
  const color = usageColor(Math.max(limit.usedPct, proj ? Math.min(100, proj.projected) : 0));
  const nowX = x(now);
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full overflow-visible" style={{ height: H }} aria-hidden>
        <line x1={0} x2={W} y1={y(50)} y2={y(50)} stroke="var(--g-track)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="var(--g-track)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
        <path d={area} fill={usageColor(limit.usedPct)} opacity={0.16} />
        <path d={line} fill="none" stroke={usageColor(limit.usedPct)} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {proj && proj.runsOutAt ? (
          <>
            <path d={`M${nowX},${y(limit.usedPct)} L${x(proj.runsOutAt)},${y(100)}`} fill="none" stroke="var(--g-bad)" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            <path d={`M${x(proj.runsOutAt)},${y(100)} L${W},${y(100)}`} fill="none" stroke="var(--g-bad)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" opacity={0.5} />
          </>
        ) : proj ? (
          <path d={`M${nowX},${y(limit.usedPct)} L${W},${y(proj.projected)}`} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" opacity={0.8} />
        ) : null}
        <line x1={nowX} x2={nowX} y1={0} y2={H} stroke="var(--g-faint)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="1 2" />
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] text-faint tabular-nums">
        <span>{shortWhen(start, limit.windowMs, hour24)}</span>
        <span>now</span>
        <span>{shortWhen(end, limit.windowMs, hour24)}</span>
      </div>
    </div>
  );
}

export function projectionText(l: AiLimit, now: number, hour24: boolean): string | null {
  const p = project(l, now);
  if (!p) return null;
  if (p.runsOutAt) return `Keeping this rate, you hit the cap ${resetAt(p.runsOutAt, now, hour24)} - ${resetIn(l.resetsAt, p.runsOutAt)} ahead of the reset.`;
  return `Keeping this rate, about ${pct(Math.min(100, p.projected))} will be used when it resets.`;
}

/** One limit: label, big percentage, bar, reset time, the usage chart and the projection. */
export function LimitBlock({ limit, now, points, chart = true, note }: { limit: AiLimit; now: number; points?: Point[]; chart?: boolean; note?: ReactNode }) {
  const hour24 = useSettings((s) => s.clock24h);
  const history = useHistory();
  const pts = points && points.length ? points : history[historyKey(limit)]?.points ?? [];
  const text = chart ? projectionText(limit, now, hour24) : null;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[12.5px] text-dim">{limit.label}</div>
        <div className="text-[22px] leading-none font-semibold tabular-nums" style={{ color: limit.usedPct >= 70 ? usageColor(limit.usedPct) : undefined }}>
          {pct(limit.usedPct)}
        </div>
      </div>
      <ProgressBar className="mt-2" value={limit.usedPct} color={usageColor(limit.usedPct)} height={6} />
      <div className="mt-1.5 text-[11.5px] text-dim">{resetLine(limit, now, hour24)}</div>
      {chart && <UsageChart limit={limit} points={pts} now={now} />}
      {text && <div className="mt-1.5 text-[11.5px] leading-snug text-dim">{text}</div>}
      {note && <div className="mt-1 text-[11px] text-faint">{note}</div>}
    </div>
  );
}

function day(t: number | null | undefined): string {
  if (!t) return "–";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
      <span className="text-dim">{label}</span>
      <span className="min-w-0 truncate text-right text-fg tabular-nums">{children}</span>
    </div>
  );
}

/** Plan, charge dates and extra usage where the vendor shares them. */
export function PlanBlock({ reading, extra }: { reading: ToolReading; extra?: ReactNode }) {
  const b = reading.billing;
  const est = b?.estimated ? "≈ " : "";
  const rows: ReactNode[] = [];
  if (reading.plan) rows.push(<Row key="plan" label="Plan">{reading.plan}</Row>);
  if (b?.lastCharge) rows.push(<Row key="last" label="Last charge">{est + day(b.lastCharge)}</Row>);
  if (b?.nextCharge) rows.push(<Row key="next" label="Next charge">{est + day(b.nextCharge)}</Row>);
  if (b?.extraUsage !== undefined && b?.extraUsage !== null) rows.push(<Row key="extra" label="Extra usage">{b.extraUsage ? "On" : "Off"}</Row>);
  for (const d of reading.details) rows.push(<Row key={`d-${d.label}`} label={d.label}>{d.value}</Row>);
  if (!rows.length && !extra) return null;
  return (
    <Section title="Plan">
      <div className="divide-y divide-card-line">
        {rows}
        {extra}
      </div>
      {b?.estimated && <div className="pb-2 text-[11px] text-faint">≈ estimated from your plan's start date; the vendor doesn't expose billing dates.</div>}
    </Section>
  );
}

export { Row as PlanRow };

/** Plain-language state: not signed in / expired / offline (with the last reading kept). */
export function StatusNote({ tool, view, onCheck }: { tool: ToolId; view: View<ToolReading> | View<{ status: string; message?: string | null }>; onCheck: () => void }) {
  const r = view.data as { status: string; message?: string | null } | undefined;
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      onCheck();
      await new Promise((res) => setTimeout(res, 600));
    } finally {
      setChecking(false);
    }
  };
  if (view.error) {
    const last = view.updatedAt ? ` The numbers below are from ${relativeTime(view.updatedAt)}.` : "";
    const msg = isOffline(view.error) ? `${TOOLS[tool].name} isn't reachable at the moment.${last}` : `${describeError(view.error)}${last}`;
    return <ErrorState className="mb-3" message={msg} onRetry={view.refresh} />;
  }
  if (!r || r.status === "ok" || !r.message) return null;
  const tone = r.status === "expired" || r.status === "signed_out" ? "bg-warn/10" : "bg-input";
  return (
    <div className={cx("mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] leading-snug text-fg", tone)}>
      <div className="min-w-0 flex-1">{r.message}</div>
      {(r.status === "expired" || r.status === "signed_out" || r.status === "not_installed") && (
        <Button size="sm" variant="ghost" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Check again"}
        </Button>
      )}
    </div>
  );
}

/** Card frame for an AI tool: glyph, plan + freshness subtitle, refresh and "open the vendor's page". */
export function AiCardFrame({ tool, title, view, sample, children, footer }: { tool: ToolId; title?: string; view: { updatedAt?: number; loading: boolean; refresh: () => void; fromCache?: boolean }; sample: boolean; children: ReactNode; footer?: ReactNode }) {
  useNow("minute");
  const meta = TOOLS[tool];
  const fresh = view.updatedAt ? `Updated ${relativeTime(view.updatedAt)}` : view.loading ? "Checking…" : "";
  return (
    <CardFrame
      title={
        <span className="flex items-center gap-2">
          {title ?? meta.name}
          {sample && <SampleBadge />}
        </span>
      }
      subtitle={sample ? "Sample numbers" : fresh || undefined}
      icon={meta.icon}
      actions={
        <>
          {meta.url && <IconButton icon={ExternalLink} label={`View usage on ${meta.name}'s site`} onClick={() => call("shell", "open", { target: meta.url })} />}
          {!sample && <IconButton icon={RefreshCw} label="Refresh" onClick={view.refresh} className={view.loading ? "animate-spin" : undefined} />}
        </>
      }
      footer={
        footer ?? (
          <div className="flex min-w-0 items-center gap-2 text-[11px] leading-snug text-faint">
            <Glyph tool={tool} size={13} className="text-faint" />
            <span className="min-w-0">{meta.sourceNote}</span>
          </div>
        )
      }
    >
      {children}
    </CardFrame>
  );
}

export function LimitsSkeleton() {
  return (
    <Section>
      <div className="space-y-3 py-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </Section>
  );
}
