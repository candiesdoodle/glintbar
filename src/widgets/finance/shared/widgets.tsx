/**
 * Builds the two widgets every store gets (a 30-day number and a 14-day chart) and their card
 * from one RevenueProvider, so each provider is a single file.
 */
import { CalendarClock, Store, TrendingUp } from "lucide-react";
import { defineWidget, type CardProps, type TileProps, type WidgetDef } from "../../../core/widget";
import { CardFrame, ListRow, Stat } from "../../../ui";
import { disconnectAccount, makeConnect } from "./account";
import { fullMoney, shortMoney, AccountFooter, CardChart, CardHero, CardStatus, ChartTile, GlyphIcon, MetricTile, StatGrid, TestModeBadge, dayLabel, statusOf } from "./kit";
import { clearCalendar, summarize, useRevenue, type RevenueData, type RevenueProvider } from "./revenue";

export const fmtShort = (v: number, cur: string) => shortMoney(v, cur);
const fmtFull = (v: number, cur: string) => fullMoney(v, cur);

function netWord(d: RevenueData | undefined): string {
  return d?.gross ? "Revenue" : "Net revenue";
}

export function RevenueNumberTile({ provider, size, isSample }: { provider: RevenueProvider; size: number; isSample: boolean }) {
  const { data, poll } = useRevenue(provider, isSample);
  const s = data ? summarize(data.days) : undefined;
  const cur = data?.currency ?? "USD";
  return (
    <MetricTile
      glyph={provider.glyph}
      label={data?.testMode ? `${provider.short ?? provider.name} · test` : (provider.short ?? provider.name)}
      value={s ? fmtShort(s.month, cur) : "–"}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={s ? `${netWord(data)}, last 30 days: ${fmtFull(s.month, cur)}\nToday: ${fmtFull(s.today, cur)}` : undefined}
    />
  );
}

export function RevenueChartTile({ provider, size, isSample }: { provider: RevenueProvider; size: number; isSample: boolean }) {
  const { data, poll } = useRevenue(provider, isSample);
  const s = data ? summarize(data.days) : undefined;
  const cur = data?.currency ?? "USD";
  return (
    <ChartTile
      glyph={provider.glyph}
      label={provider.short ?? provider.name}
      value={s ? fmtShort(s.week, cur) : "–"}
      change={s?.weekChange}
      data={s?.chart ?? []}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={s ? `This week: ${fmtFull(s.week, cur)} (last week ${fmtFull(s.prevWeek, cur)})` : undefined}
    />
  );
}

export function RevenueCard({ provider, isSample, close }: { provider: RevenueProvider } & Pick<CardProps, "isSample" | "close">) {
  const { data, poll } = useRevenue(provider, isSample);
  const s = data ? summarize(data.days) : undefined;
  const cur = data?.currency ?? "USD";
  const f = (v: number | undefined) => (v === undefined ? "–" : fmtFull(v, cur));
  return (
    <CardFrame
      title={provider.name}
      subtitle={netWord(data) + (data?.gross ? " (gross, because the balance ledger was not readable)" : ", fees and refunds taken out")}
      icon={TrendingUp}
      actions={data?.testMode ? <TestModeBadge /> : undefined}
      footer={
        <AccountFooter
          url={provider.dashboardUrl}
          urlLabel={`Open ${provider.name}`}
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void disconnectAccount(provider.account);
                  clearCalendar(provider.id);
                  close();
                }
          }
        />
      }
    >
      <CardHero label={`${netWord(data)} · last 30 days`} value={s ? f(s.month) : "–"} sub={data?.count !== undefined ? `${data.count.toLocaleString()} ${provider.countLabel}${data.capped ? "+" : ""}` : undefined} />
      <CardChart data={s?.chart ?? []} labels={s ? [dayLabel(s.chartDays[0]), "Today"] : undefined} format={(v) => fmtShort(v, cur)} />
      <StatGrid>
        <Stat label="Today" value={f(s?.today)} />
        <Stat label="Last 7 days" value={f(s?.week)} sub={s?.weekChange !== undefined ? `${s.weekChange >= 0 ? "+" : ""}${Math.round(s.weekChange)}% vs prior 7d` : undefined} />
        <Stat label="This month" value={f(s?.mtd)} />
      </StatGrid>
      {data && data.others.length > 0 && <p className="mt-2 text-[11px] text-faint">Totals use {cur}. Sales in other currencies ({data.others.join(", ")}) are not counted.</p>}
      {data?.capped && <p className="mt-2 text-[11px] text-faint">Only the newest {provider.countLabel} were counted, because this account has too many to fetch.</p>}
      {data?.upcoming && data.upcoming.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Coming up</div>
          {data.upcoming.slice(0, 4).map((u) => (
            <ListRow
              key={u.date + u.title}
              icon={CalendarClock}
              title={u.title}
              subtitle={dayLabel(u.date)}
              right={u.amount !== undefined && u.kind !== "milestone" ? fmtFull(u.amount, u.currency ?? cur) : undefined}
            />
          ))}
        </div>
      )}
      <CardStatus poll={poll} isSample={isSample} sampleText={`These are sample figures. Add a read-only ${provider.name} key to see your own.`} />
    </CardFrame>
  );
}

/** The 30-day number widget and the 14-day chart widget for a store. */
export function revenueWidgets(p: RevenueProvider): { number: WidgetDef; chart: WidgetDef } {
  const Connect = makeConnect(p.account);
  const Card = (props: CardProps) => <RevenueCard provider={p} isSample={props.isSample} close={props.close} />;
  const common = { category: "Finance" as const, icon: Store, Card, Connect, disconnect: () => disconnectAccount(p.account), cardSize: { width: 340 }, keywords: ["revenue", "sales", "money", "income", p.name.toLowerCase()] };
  return {
    number: defineWidget({
      ...common,
      id: `finance.${p.id}`,
      name: p.name,
      description: numberDescription(p),
      size: "m",
      Tile: (t: TileProps) => <RevenueNumberTile provider={p} size={t.size} isSample={t.isSample} />,
    }),
    chart: defineWidget({
      ...common,
      id: `finance.${p.id}-chart`,
      name: `${p.name} Chart`,
      description: `${p.name} revenue over 14 days, this week against last.`,
      keywords: [...common.keywords, "chart", "graph", "line"],
      size: "l",
      Tile: (t: TileProps) => <RevenueChartTile provider={p} size={t.size} isSample={t.isSample} />,
    }),
  };
}

function numberDescription(p: RevenueProvider): string {
  switch (p.id) {
    case "shopify":
      return "Shopify order totals for the past 30 days, with refunds taken off.";
    case "lemonsqueezy":
      return "Paid Lemon Squeezy orders in the past 30 days, less tax and refunds.";
    case "paddle":
      return "Paddle earnings for the past 30 days, net of tax, fees and refunds.";
    case "gumroad":
      return "Gumroad sales for the past 30 days, minus Gumroad's fee and any refunds.";
    default:
      return `${p.name} net revenue for the past 30 days.`;
  }
}

export { GlyphIcon };
