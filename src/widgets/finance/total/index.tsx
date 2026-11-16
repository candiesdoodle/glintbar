import { Target } from "lucide-react";
import { useConnections } from "../../../core/connections";
import { httpJson } from "../../../core/http";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ListRow, ProgressBar, Section, SettingRow, Stat, TextInput, TileFrame } from "../../../ui";
import { fullMoney, CardChart, CardHero, GlyphIcon, StatGrid, TileLabel, TileSampleBadge, dayLabel } from "../shared/kit";
import { usePolled } from "../shared/poll";
import { PROVIDERS } from "../shared/providers";
import { summarize, useRevenue, type DailyPoint } from "../shared/revenue";
import { fmtShort } from "../shared/widgets";
import { money } from "../../../core/format";

interface TotalConfig extends Record<string, unknown> {
  /** Monthly goal in `currency`; 0 = none. */
  goal: number;
  /** "" = the biggest store's currency. */
  currency: string;
}

interface FxRates {
  base: string;
  rates: Record<string, number>;
}

export function convert(amount: number, from: string, to: string, fx: FxRates | undefined): number | undefined {
  if (from === to) return amount;
  if (!fx) return undefined;
  const rate = (c: string) => (c === fx.base ? 1 : fx.rates[c]);
  const a = rate(from);
  const b = rate(to);
  if (!a || !b) return undefined;
  return (amount / a) * b;
}

const SAMPLE_IDS = ["stripe", "polar", "gumroad"];

/** Every connected store's data, converted into one currency. */
function useTotal(config: TotalConfig, isPreview: boolean) {
  const connected = useConnections((s) => s.connected);
  const rows = PROVIDERS.map((p) => {
    const live = Boolean(connected[p.account.ids[0]]) && !isPreview;
    // Hooks in a fixed order: one per provider, sample (no fetch) when not connected.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const r = useRevenue(p, !live);
    return { p, live, ...r };
  });
  const anyLive = rows.some((r) => r.live);
  const used = anyLive ? rows.filter((r) => r.live) : rows.filter((r) => SAMPLE_IDS.includes(r.p.id));
  const biggest = [...used].sort((a, b) => (b.data ? summarize(b.data.days).month : 0) - (a.data ? summarize(a.data.days).month : 0))[0];
  const target = (config.currency || biggest?.data?.currency || "USD").toUpperCase();
  const needsFx = used.some((r) => r.data && r.data.currency !== target);
  const fx = usePolled<FxRates>(needsFx && anyLive ? "finance.fx:USD" : null, () => httpJson<FxRates>("https://api.frankfurter.dev/v1/latest", { query: { base: "USD" } }), {
    refreshMs: 12 * 3600_000,
  });

  const days = new Map<string, number>();
  const parts: Array<{ id: string; name: string; glyph: (typeof PROVIDERS)[number]["glyph"]; month?: number; native?: string; error?: string }> = [];
  let skipped = 0;
  for (const r of used) {
    if (!r.data) {
      parts.push({ id: r.p.id, name: r.p.name, glyph: r.p.glyph, error: r.poll.message ?? "Loading…" });
      continue;
    }
    const cur = r.data.currency;
    let ok = true;
    for (const d of r.data.days) {
      const v = convert(d.net, cur, target, fx.data);
      if (v === undefined) {
        ok = false;
        break;
      }
      days.set(d.date, (days.get(d.date) ?? 0) + v);
    }
    if (!ok) skipped++;
    const month = summarize(r.data.days).month;
    parts.push({ id: r.p.id, name: r.p.name, glyph: r.p.glyph, month: ok ? convert(month, cur, target, fx.data) : undefined, native: cur !== target ? money(month, cur, { short: true }) : undefined });
  }
  const first = used.find((r) => r.data)?.data?.days ?? [];
  const merged: DailyPoint[] = first.map((d) => ({ date: d.date, net: Math.round((days.get(d.date) ?? 0) * 100) / 100, currency: target }));
  const s = summarize(merged);
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = (s.mtd / Math.max(1, now.getDate() - 1 + now.getHours() / 24)) * dim;
  const goal = config.goal > 0 ? config.goal : anyLive ? 0 : Math.max(1000, Math.ceil((pace * 1.15) / 5000) * 5000);
  return { anyLive, target, s, parts, skipped, goal, pace, loading: anyLive && used.every((r) => !r.data) };
}

function TotalTile({ config, size, isSample }: TileProps<TotalConfig>) {
  const t = useTotal(config, isSample);
  const sample = isSample || !t.anyLive;
  const pct = t.goal > 0 ? t.s.mtd / t.goal : undefined;
  const small = Math.max(9, Math.round(size * 0.21));
  return (
    <TileFrame title={`All stores, last 30 days: ${money(t.s.month, t.target)}`}>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[2px] leading-none">
      <div className="flex items-center gap-[0.35em]">
        <GlyphIcon glyph={Target} size={Math.round(small * 1.15)} className="text-dim" />
        <TileLabel size={size} className="min-w-0 flex-1">{sample ? "Revenue" : "Revenue · 30d"}</TileLabel>
        {sample && <TileSampleBadge size={size} />}
      </div>
      <div className="flex min-w-0 items-baseline gap-[0.4em] whitespace-nowrap">
        <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.34) }}>
          {t.loading ? "…" : fmtShort(t.s.month, t.target)}
        </span>
        {pct !== undefined && (
          <span className={t.pace >= t.goal ? "truncate text-good" : "truncate text-dim"} style={{ fontSize: small }}>
            {Math.round(pct * 100)}% of {fmtShort(t.goal, t.target)}
          </span>
        )}
      </div>
      {pct !== undefined && size >= 40 && <ProgressBar value={t.s.mtd} max={t.goal} height={Math.max(3, Math.round(size * 0.07))} color={t.pace >= t.goal ? "var(--g-good)" : "var(--g-accent)"} />}
      </div>
    </TileFrame>
  );
}

function TotalCard({ config, setConfig, isSample }: CardProps<TotalConfig>) {
  const t = useTotal(config, false);
  const sample = isSample || !t.anyLive;
  const f = (v: number) => fullMoney(v, t.target, false);
  return (
    <CardFrame title="Total Revenue" subtitle={sample ? "Sample data - connect a store to see your total" : `Your connected stores, converted to ${t.target}`} icon={Target}>
      <CardHero label="Last 30 days" value={f(t.s.month)} change={t.s.weekChange} sub="this week vs last" />
      <CardChart data={t.s.chart} labels={t.s.chartDays.length ? [dayLabel(t.s.chartDays[0]), "Today"] : undefined} height={72} format={(v) => fmtShort(v, t.target)} />
      <StatGrid>
        <Stat label="This month" value={f(t.s.mtd)} />
        <Stat label="On pace for" value={fmtShort(t.pace, t.target)} sub={t.goal > 0 ? (t.pace >= t.goal ? "Ahead of goal" : `${f(Math.max(0, t.goal - t.s.mtd))} to go`) : undefined} />
        <Stat label="Goal" value={t.goal > 0 ? fmtShort(t.goal, t.target) : "None"} sub={t.goal > 0 ? `${Math.round((t.s.mtd / t.goal) * 100)}% reached` : undefined} />
      </StatGrid>
      {t.goal > 0 && <ProgressBar className="mt-2.5" value={t.s.mtd} max={t.goal} color={t.pace >= t.goal ? "var(--g-good)" : "var(--g-accent)"} />}
      <div className="mt-3">
        {t.parts.map((p) => (
          <ListRow
            key={p.id}
            leading={<GlyphIcon glyph={p.glyph} size={15} className="text-dim" />}
            title={p.name}
            subtitle={p.error ?? p.native}
            right={p.month !== undefined ? f(p.month) : p.error ? "–" : "No rate"}
          />
        ))}
      </div>
      {t.skipped > 0 && <p className="mt-1 text-[11px] text-faint">No exchange rate to {t.target} yet for some stores, so they are not in the total.</p>}
      <Section title="Settings" className="mt-3 mb-0">
        <SettingRow label="Monthly goal" description="Blank means no goal.">
          <div className="w-[96px]"><TextInput
            className="text-right"
            inputMode="numeric"
            placeholder="10000"
            value={config.goal ? String(config.goal) : ""}
            onChange={(e) => setConfig({ goal: Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) })}
          /></div>
        </SettingRow>
        <SettingRow label="Currency" description="Blank picks the currency of your top-earning store.">
          <div className="w-[64px]"><TextInput
            className="text-center uppercase"
            maxLength={3}
            placeholder={t.target}
            value={config.currency}
            onChange={(e) => setConfig({ currency: e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3) })}
          /></div>
        </SettingRow>
      </Section>
    </CardFrame>
  );
}

export default defineWidget<TotalConfig>({
  id: "finance.total",
  name: "Total Revenue",
  category: "Finance",
  description: "All connected stores' revenue in one total, with a monthly goal.",
  keywords: ["revenue", "goal", "mrr", "income", "sales", "stores"],
  icon: Target,
  size: "l",
  Tile: TotalTile,
  Card: TotalCard,
  cardSize: { width: 340 },
  defaultConfig: { goal: 0, currency: "" },
});
