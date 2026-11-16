import { httpJson, HttpError } from "../../../../core/http";
import { money } from "../../../../core/format";
import { monogram } from "../kit";
import { guard, setSetting, type Ctx } from "../account";
import type { ProviderResult, RevenueData, RevenueEntry, RevenueProvider, UpcomingItem } from "../revenue";
import { dayKey } from "../sample";

export interface PolarMetricsResponse {
  periods: Array<{ timestamp: string; net_revenue?: number | null; revenue?: number | null; orders?: number | null }>;
  totals?: { net_revenue?: number | null; revenue?: number | null; orders?: number | null };
}

/** Polar metrics are in cents of the organization's currency. */
export function polarEntries(res: PolarMetricsResponse, currency: string): { entries: RevenueEntry[]; count: number } {
  const entries: RevenueEntry[] = [];
  let count = 0;
  for (const p of res.periods ?? []) {
    const cents = p.net_revenue ?? 0;
    count += p.orders ?? 0;
    entries.push({ at: p.timestamp.slice(0, 10), amount: cents / 100, currency });
  }
  return { entries, count };
}

const NAME = "Polar";
const ACC = { ns: "finance.polar" };
const BASES = { live: "https://api.polar.sh", sandbox: "https://sandbox-api.polar.sh" } as const;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });

function metricsUrl(base: string, start: string, end: string, interval: string): string {
  return `${base}/v1/metrics/?start_date=${start}&end_date=${end}&interval=${interval}&timezone=${encodeURIComponent(tz())}`;
}

/** Live first, then sandbox: a sandbox token is recognised on its own. */
async function withEnv<T>(ctx: Ctx, fn: (base: string) => Promise<T>): Promise<{ value: T; sandbox: boolean }> {
  const remembered = ctx.settings.env === "sandbox" ? "sandbox" : "live";
  const order: Array<"live" | "sandbox"> = remembered === "sandbox" ? ["sandbox", "live"] : ["live", "sandbox"];
  let first: unknown;
  for (const env of order) {
    try {
      const value = await fn(BASES[env]);
      if (!ctx.testing && env !== remembered) setSetting(ACC, "env", env);
      return { value, sandbox: env === "sandbox" };
    } catch (e) {
      if (!(e instanceof HttpError && e.kind === "unauthorized")) throw e;
      first ??= e;
    }
  }
  throw first;
}

async function currencyOf(ctx: Ctx, base: string): Promise<string> {
  try {
    const res = await httpJson<{ items: Array<{ currency?: string }> }>(`${base}/v1/orders/?limit=1`, { headers: auth(ctx) });
    return (res.items?.[0]?.currency ?? "usd").toUpperCase();
  } catch {
    return "USD"; // no orders:read scope: numbers stay right, shown in USD
  }
}

async function fetchPolar(ctx: Ctx, range: { start: Date; end: Date }): Promise<ProviderResult> {
  const { value, sandbox } = await guard(
    NAME,
    () =>
      withEnv(ctx, async (base) => {
        const res = await httpJson<PolarMetricsResponse>(metricsUrl(base, dayKey(range.start), dayKey(range.end), "day"), { headers: auth(ctx) });
        return { res, currency: await currencyOf(ctx, base) };
      }),
    { forbidden: "Polar knows this token, but reading this data is not allowed. It needs the orders:read and metrics:read scopes." },
  );
  const { entries, count } = polarEntries(value.res, value.currency);
  return { entries, count, testMode: sandbox };
}

export const MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

/** The next lifetime milestone and when this month's pace reaches it (within a year). */
export function nextMilestone(lifetime: number, perDay: number, now = new Date()): { amount: number; date: string } | undefined {
  const next = MILESTONES.find((m) => m > lifetime);
  if (!next || perDay <= 0) return undefined;
  const days = Math.ceil((next - lifetime) / perDay);
  if (days > 365) return undefined;
  return { amount: next, date: dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)) };
}

async function polarMilestones(ctx: Ctx, data: RevenueData): Promise<UpcomingItem[]> {
  const base = ctx.settings.env === "sandbox" ? BASES.sandbox : BASES.live;
  const now = new Date();
  const from = dayKey(new Date(now.getFullYear() - 4, now.getMonth(), 1));
  const res = await httpJson<PolarMetricsResponse>(metricsUrl(base, from, dayKey(now), "year"), { headers: auth(ctx) });
  const lifetime = (res.totals?.net_revenue ?? (res.periods ?? []).reduce((a, p) => a + (p.net_revenue ?? 0), 0)) / 100;
  const month = data.days.slice(-30).reduce((a, d) => a + d.net, 0);
  const m = nextMilestone(lifetime, month / 30, now);
  if (!m) return [];
  return [{ date: m.date, title: `Polar: ${money(m.amount, data.currency, { short: true })} lifetime`, kind: "milestone", amount: m.amount, currency: data.currency }];
}

export const polar: RevenueProvider = {
  id: "polar",
  name: NAME,
  glyph: monogram("P"),
  dashboardUrl: "https://polar.sh/dashboard",
  countLabel: "orders",
  sample: { base: 268, currency: "USD", perOrder: 24 },
  account: {
    ns: ACC.ns,
    name: NAME,
    ids: ["finance.polar", "finance.polar-chart"],
    spec: {
      fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "polar_oat_…", help: "Organization access token; scopes orders:read and metrics:read." }],
      guide: {
        steps: [
          "Go to Settings in your Polar dashboard; under Developers, press New Token.",
          "Choose any name, set when it expires, and tick orders:read and metrics:read.",
          "Copy the new token (it begins polar_oat_…). Sandbox tokens are accepted too.",
        ],
        url: "https://polar.sh/dashboard",
        linkLabel: "Open Polar",
      },
      test: async (values) => {
        const ctx: Ctx = { secret: (f) => values[f] ?? "", settings: values, testing: true };
        const today = dayKey(new Date());
        await guard(NAME, () => withEnv(ctx, (base) => httpJson(metricsUrl(base, today, today, "day"), { headers: auth(ctx) })), {
          forbidden: "Polar knows this token, but reading this data is not allowed. It needs the orders:read and metrics:read scopes.",
        });
      },
    },
  },
  fetch: fetchPolar,
  fetchUpcoming: polarMilestones,
};
