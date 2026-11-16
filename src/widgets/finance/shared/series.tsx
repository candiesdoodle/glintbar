/**
 * A generic "daily number" widget: a 14-day line with this week's total and its change on the
 * tile, and a card with the line plus a few stats. Used by DataFast, Plausible, Dub and Resend.
 */
import { useMemo, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type Category, type TileProps, type WidgetDef } from "../../../core/widget";
import { CardFrame, ListRow, Stat } from "../../../ui";
import { disconnectAccount, liveCtx, makeConnect, type Account, type Ctx } from "./account";
import { AccountFooter, CardChart, CardHero, CardStatus, ChartTile, StatGrid, dayLabel, pctChange, statusOf, type Glyph } from "./kit";
import { usePolled, type Polled } from "./poll";

export interface SeriesData {
  /** YYYY-MM-DD, oldest first (14 days ending today). */
  days: string[];
  values: number[];
  /** Overrides the summed week when the metric isn't additive (unique visitors). */
  week?: { value: number; prev: number };
  stats?: Array<{ label: string; value: string; sub?: string }>;
  rows?: Array<{ title: string; subtitle?: string; right?: string }>;
  rowsTitle?: string;
  note?: string;
}

export function weekOf(d: SeriesData): { value: number; prev: number; change?: number } {
  if (d.week) return { ...d.week, change: pctChange(d.week.value, d.week.prev) };
  const n = d.values.length;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const value = sum(d.values.slice(Math.max(0, n - 7)));
  const prev = sum(d.values.slice(Math.max(0, n - 14), Math.max(0, n - 7)));
  return { value, prev, change: pctChange(value, prev) };
}

/** Aligns sparse {day: value} pairs onto `days` (missing days are 0). */
export function alignDays(days: string[], pairs: Array<[string, number]>): number[] {
  const m = new Map<string, number>();
  for (const [d, v] of pairs) m.set(d.slice(0, 10), (m.get(d.slice(0, 10)) ?? 0) + (Number(v) || 0));
  return days.map((d) => m.get(d) ?? 0);
}

export interface SeriesSpec {
  account: Account;
  glyph: Glyph;
  icon: LucideIcon;
  /** Tile label, e.g. "Visitors · 7d". */
  label: string;
  /** Card hero label, e.g. "Visitors, last 7 days". */
  heroLabel: string;
  refreshMs: number;
  load: (ctx: Ctx) => Promise<SeriesData>;
  sample: () => SeriesData;
  dashboardUrl?: string;
  format?: (n: number) => string;
  /** A rise is bad (bounces). */
  invert?: boolean;
}

export function useSeries(spec: SeriesSpec, isSample: boolean): { data: SeriesData | undefined; poll: Polled<SeriesData> } {
  const sample = useMemo(() => (isSample ? spec.sample() : undefined), [spec, isSample]);
  const poll = usePolled<SeriesData>(isSample ? null : `${spec.account.ns}:series`, () => spec.load(liveCtx(spec.account)), { refreshMs: spec.refreshMs });
  return { data: isSample ? sample : poll.data, poll };
}

export function seriesWidget(
  spec: SeriesSpec,
  def: { id: string; name: string; category: Category; description: string; keywords?: string[] },
): WidgetDef {
  const fmt = spec.format ?? ((n: number) => shortNumber(n));
  const Tile = ({ size, isSample }: TileProps) => {
    const { data, poll } = useSeries(spec, isSample);
    const w = data ? weekOf(data) : undefined;
    return (
      <ChartTile
        glyph={spec.glyph}
        label={spec.label}
        value={w ? fmt(w.value) : "–"}
        change={w?.change}
        invert={spec.invert}
        data={data?.values ?? []}
        size={size}
        isSample={isSample}
        status={statusOf(poll, isSample)}
        title={w ? `${spec.heroLabel}: ${w.value.toLocaleString()} (week before: ${w.prev.toLocaleString()})` : undefined}
      />
    );
  };
  const Card: ComponentType<CardProps> = ({ isSample, close }) => {
    const { data, poll } = useSeries(spec, isSample);
    const w = data ? weekOf(data) : undefined;
    return (
      <CardFrame
        title={def.name}
        subtitle={spec.heroLabel}
        icon={spec.icon}
        footer={
          <AccountFooter
            url={spec.dashboardUrl}
            urlLabel={`Open ${spec.account.name}`}
            onDisconnect={
              isSample
                ? undefined
                : () => {
                    void disconnectAccount(spec.account);
                    close();
                  }
            }
          />
        }
      >
        <CardHero label={spec.heroLabel} value={w ? w.value.toLocaleString() : "–"} change={w?.change} invert={spec.invert} sub="vs the week before" />
        <CardChart data={data?.values ?? []} labels={data?.days.length ? [dayLabel(data.days[0]), "Today"] : undefined} format={fmt} />
        {data?.stats && data.stats.length > 0 && (
          <StatGrid>
            {data.stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} sub={s.sub} />
            ))}
          </StatGrid>
        )}
        {data?.rows && data.rows.length > 0 && (
          <div className="mt-3">
            {data.rowsTitle && <div className="mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">{data.rowsTitle}</div>}
            {data.rows.map((r) => (
              <ListRow key={r.title} title={r.title} subtitle={r.subtitle} right={r.right} />
            ))}
          </div>
        )}
        {data?.note && <p className="mt-2 text-[11px] text-faint">{data.note}</p>}
        <CardStatus poll={poll} isSample={isSample} sampleText={`These are sample figures. Connect ${spec.account.name} to see your own.`} />
      </CardFrame>
    );
  };
  return defineWidget({
    ...def,
    icon: spec.icon,
    size: "l",
    Tile,
    Card,
    Connect: makeConnect(spec.account),
    disconnect: () => disconnectAccount(spec.account),
    cardSize: { width: 340 },
  });
}
