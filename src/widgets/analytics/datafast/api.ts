import { httpJson } from "../../../core/http";
import { duration, money, shortNumber } from "../../../core/format";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { lastDays, sampleSeries, startOfDay, dayKey } from "../../finance/shared/sample";
import { alignDays, type SeriesData } from "../../finance/shared/series";

export interface DatafastTimeseries {
  status: string;
  data: Array<{ timestamp: string; visitors?: number }>;
}
export interface DatafastOverview {
  status: string;
  data: Array<{ visitors?: number; sessions?: number; bounce_rate?: number; avg_session_duration?: number; currency?: string; revenue?: number; conversion_rate?: number }>;
}

const NAME = "DataFast";
const API = "https://datafa.st/api/v1/analytics";
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });

export function datafastSeries(ts: DatafastTimeseries, overview: DatafastOverview | undefined, days: string[]): SeriesData {
  const values = alignDays(days, (ts.data ?? []).map((p) => [p.timestamp.slice(0, 10), p.visitors ?? 0]));
  const o = overview?.data?.[0];
  const stats: SeriesData["stats"] = [{ label: "Today", value: shortNumber(values[values.length - 1] ?? 0) }];
  if (o) {
    stats.push(
      { label: "Sessions · 30d", value: shortNumber(o.sessions ?? 0) },
      { label: "Revenue · 30d", value: money(o.revenue ?? 0, o.currency || "USD", { short: true }) },
      { label: "Conversion", value: `${(o.conversion_rate ?? 0).toFixed(1)}%` },
      { label: "Time on site", value: duration(o.avg_session_duration ?? 0) },
      { label: "Bounce rate", value: `${Math.round(o.bounce_rate ?? 0)}%` },
    );
  }
  return { days, values, stats };
}

export async function loadDatafast(ctx: Ctx): Promise<SeriesData> {
  const days = lastDays(14);
  const ts = await guard(NAME, () =>
    httpJson<DatafastTimeseries>(`${API}/timeseries`, { headers: auth(ctx), query: { fields: "visitors", interval: "day", startAt: days[0], endAt: days[13], timezone: tz() } }),
  );
  let overview: DatafastOverview | undefined;
  try {
    overview = await httpJson<DatafastOverview>(`${API}/overview`, {
      headers: auth(ctx),
      query: { startAt: dayKey(startOfDay(29)), endAt: days[13], timezone: tz(), fields: "visitors,sessions,bounce_rate,avg_session_duration,currency,revenue,conversion_rate" },
    });
  } catch {
    /* the card shows fewer stats */
  }
  return datafastSeries(ts, overview, days);
}

export function sampleDatafast(): SeriesData {
  const days = lastDays(14);
  const values = sampleSeries("datafast", 14, 840, { integer: true, noise: 0.25 });
  return {
    days,
    values,
    stats: [
      { label: "Today", value: shortNumber(values[13]) },
      { label: "Sessions · 30d", value: "31k" },
      { label: "Revenue · 30d", value: "$4.2k" },
      { label: "Conversion", value: "2.4%" },
      { label: "Time on site", value: "1m" },
      { label: "Bounce rate", value: "41%" },
    ],
  };
}

export const datafastAccount: Account = {
  ns: "analytics.datafast",
  name: NAME,
  ids: ["analytics.datafast"],
  spec: {
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "df_…", help: "Each website has its own key, and a key covers only that site." }],
    guide: { steps: ["In the DataFast dashboard, select your website, then open its Settings → Developer page.", "Copy that site's df_… API key."], url: "https://datafa.st/dashboard", linkLabel: "Open DataFast" },
    test: async (values) => {
      const today = dayKey(new Date());
      await guard(NAME, () => httpJson(`${API}/timeseries`, { headers: { Authorization: `Bearer ${values.apiKey}` }, query: { fields: "visitors", interval: "day", startAt: today, endAt: today } }));
    },
  },
};
