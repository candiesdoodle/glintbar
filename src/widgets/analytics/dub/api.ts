import { httpJson } from "../../../core/http";
import { money, shortNumber } from "../../../core/format";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { lastDays, sampleSeries, startOfDay } from "../../finance/shared/sample";
import { alignDays, type SeriesData } from "../../finance/shared/series";

export type DubTimeseries = Array<{ start: string; clicks: number }>;
export interface DubCount {
  clicks: number;
  leads: number;
  sales: number;
  saleAmount: number;
}

const NAME = "Dub";
const API = "https://api.dub.co/analytics";
const FORBIDDEN = "The key is valid but not allowed to see analytics: Dub includes them only on Pro and higher plans.";
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });

/** Dub's buckets start at local midnight in the requested timezone. */
export function dubDaily(res: DubTimeseries, days: string[]): number[] {
  return alignDays(
    days,
    res.map((p) => {
      const d = new Date(p.start);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return [key, p.clicks];
    }),
  );
}

export async function loadDub(ctx: Ctx): Promise<SeriesData> {
  const days = lastDays(14);
  const [ts, month] = await Promise.all([
    guard(NAME, () => httpJson<DubTimeseries>(API, { headers: auth(ctx), query: { event: "clicks", groupBy: "timeseries", start: startOfDay(13).toISOString(), end: new Date().toISOString(), timezone: tz() } }), { forbidden: FORBIDDEN }),
    guard(NAME, () => httpJson<DubCount>(API, { headers: auth(ctx), query: { event: "composite", groupBy: "count", interval: "30d", timezone: tz() } }), { forbidden: FORBIDDEN }),
  ]);
  const values = dubDaily(ts, days);
  return {
    days,
    values,
    stats: [
      { label: "Today", value: shortNumber(values[13] ?? 0) },
      { label: "Clicks · 30d", value: shortNumber(month.clicks ?? 0) },
      { label: "Leads · 30d", value: shortNumber(month.leads ?? 0) },
      { label: "Sales · 30d", value: shortNumber(month.sales ?? 0) },
      { label: "Revenue · 30d", value: money((month.saleAmount ?? 0) / 100, "USD", { short: true }) },
    ],
  };
}

export function sampleDub(): SeriesData {
  const days = lastDays(14);
  const values = sampleSeries("dub", 14, 260, { integer: true, noise: 0.4 });
  return {
    days,
    values,
    stats: [
      { label: "Today", value: shortNumber(values[13]) },
      { label: "Clicks · 30d", value: "7.6k" },
      { label: "Leads · 30d", value: "184" },
      { label: "Sales · 30d", value: "23" },
      { label: "Revenue · 30d", value: "$1.1k" },
    ],
  };
}

export const dubAccount: Account = {
  ns: "analytics.dub",
  name: NAME,
  ids: ["analytics.dub"],
  spec: {
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "dub_…", help: "A workspace key with read-only access; needs Pro or a higher plan." }],
    guide: { steps: ["Go to Settings → API Keys in your Dub workspace and press Create.", "Set the permission to Read only.", "Copy the new dub_… key."], url: "https://app.dub.co/settings/tokens", linkLabel: "Open Dub API keys" },
    test: async (values) => {
      await guard(NAME, () => httpJson(API, { headers: { Authorization: `Bearer ${values.apiKey}` }, query: { event: "clicks", interval: "24h" } }), { forbidden: FORBIDDEN });
    },
  },
};
