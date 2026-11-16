import { httpJson, httpText } from "../../../core/http";
import { duration, shortNumber } from "../../../core/format";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import { lastDays, sampleSeries } from "../../finance/shared/sample";
import { alignDays, type SeriesData } from "../../finance/shared/series";

export interface PlausibleQueryResponse {
  results: Array<{ metrics: number[]; dimensions: string[] }>;
}

const NAME = "Plausible";

export function plausibleServer(ctx: Ctx): string {
  const s = (ctx.settings.server ?? "").trim().replace(/\/+$/, "");
  if (!s) return "https://plausible.io";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function site(ctx: Ctx): string {
  const s = (ctx.settings.site ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!s) throw new PlainError("Fill in the site domain, written the way Plausible shows it (such as example.com).");
  return s;
}

async function query(ctx: Ctx, body: object): Promise<PlausibleQueryResponse> {
  return guard(
    NAME,
    () => httpJson<PlausibleQueryResponse>(`${plausibleServer(ctx)}/api/v2/query`, { method: "POST", headers: { Authorization: `Bearer ${ctx.secret("apiKey")}` }, body }),
    { notFound: "Plausible has no data for that site. Make sure Site is the same domain Plausible uses and that the site belongs to the key's team." },
  );
}

export function plausibleDaily(res: PlausibleQueryResponse, days: string[]): number[] {
  return alignDays(days, (res.results ?? []).map((r) => [r.dimensions[0], r.metrics[0]]));
}

export async function loadPlausible(ctx: Ctx): Promise<SeriesData> {
  const days = lastDays(14);
  const site_id = site(ctx);
  const [daily, week, prev, month] = await Promise.all([
    query(ctx, { site_id, metrics: ["visitors"], date_range: [days[0], days[13]], dimensions: ["time:day"] }),
    query(ctx, { site_id, metrics: ["visitors"], date_range: [days[7], days[13]] }),
    query(ctx, { site_id, metrics: ["visitors"], date_range: [days[0], days[6]] }),
    query(ctx, { site_id, metrics: ["visitors", "pageviews", "bounce_rate", "visit_duration"], date_range: "30d" }),
  ]);
  const values = plausibleDaily(daily, days);
  let realtime: number | undefined;
  try {
    realtime = Number(await httpText(`${plausibleServer(ctx)}/api/v1/stats/realtime/visitors`, { headers: { Authorization: `Bearer ${ctx.secret("apiKey")}` }, query: { site_id } }));
  } catch {
    realtime = undefined;
  }
  const m = month.results?.[0]?.metrics ?? [];
  return {
    days,
    values,
    week: { value: week.results?.[0]?.metrics?.[0] ?? 0, prev: prev.results?.[0]?.metrics?.[0] ?? 0 },
    stats: [
      { label: "Today", value: shortNumber(values[13] ?? 0) },
      { label: "Right now", value: realtime !== undefined && Number.isFinite(realtime) ? shortNumber(realtime) : "–" },
      { label: "Visitors · 30d", value: shortNumber(m[0] ?? 0) },
      { label: "Pageviews · 30d", value: shortNumber(m[1] ?? 0) },
      { label: "Bounce rate", value: `${Math.round(m[2] ?? 0)}%` },
      { label: "Visit duration", value: duration(m[3] ?? 0) },
    ],
  };
}

export function samplePlausible(): SeriesData {
  const days = lastDays(14);
  const values = sampleSeries("plausible", 14, 410, { integer: true, noise: 0.22 });
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return {
    days,
    values,
    week: { value: Math.round(sum(values.slice(7)) * 0.86), prev: Math.round(sum(values.slice(0, 7)) * 0.86) },
    stats: [
      { label: "Today", value: shortNumber(values[13]) },
      { label: "Right now", value: "7" },
      { label: "Visitors · 30d", value: "11k" },
      { label: "Pageviews · 30d", value: "27k" },
      { label: "Bounce rate", value: "48%" },
      { label: "Visit duration", value: "1m 12s" },
    ],
  };
}

export const plausibleAccount: Account = {
  ns: "analytics.plausible",
  name: NAME,
  ids: ["analytics.plausible"],
  spec: {
    fields: [
      { key: "site", label: "Site", placeholder: "example.com", help: "Spelled the same as the domain in Plausible." },
      { key: "apiKey", label: "API key", secret: true, help: "Needs a Stats API key, available on the Business plan or when self-hosting." },
      { key: "server", label: "Server", optional: true, placeholder: "https://stats.example.com", help: "Leave empty unless you host Plausible yourself." },
    ],
    guide: {
      steps: ["From the account menu in Plausible, go to Settings → API keys and press New API key.", "Pick Stats API as the key type, and pick the team that owns your site.", "Copy it right away, since Plausible will not show it again."],
      url: "https://plausible.io/settings/api-keys",
      linkLabel: "Open Plausible API keys",
    },
    test: async (values) => {
      const ctx: Ctx = { secret: (f) => values[f] ?? "", settings: values, testing: true };
      await query(ctx, { site_id: site(ctx), metrics: ["visitors"], date_range: "day" });
    },
  },
};
