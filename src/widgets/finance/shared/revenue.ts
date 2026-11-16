/**
 * The revenue provider contract and everything the finance tiles share: daily bucketing,
 * currency choice, summaries, sample data, the 15-minute cached poller and calendar publishing.
 */
import { money } from "../../../core/format";
import { getStored, setStored } from "../../../core/store";
import type { Glyph } from "./kit";
import { liveCtx, type Account, type Ctx } from "./account";
import { usePolled, type Polled } from "./poll";
import { dayKey, lastDays, sampleSeries, startOfDay } from "./sample";

export const REVENUE_REFRESH_MS = 15 * 60_000;
/** Days fetched: 31 so month-to-date always fits; the "30 days" figure uses the last 30. */
export const FETCH_DAYS = 31;

export interface DailyPoint {
  date: string;
  net: number;
  currency: string;
}

/** One money movement. `at`: unix ms, an ISO time, or an exact "YYYY-MM-DD" day. Amount in major units. */
export interface RevenueEntry {
  at: number | string;
  amount: number;
  currency: string;
}

export interface ProviderResult {
  entries: RevenueEntry[];
  testMode?: boolean;
  /** Gross instead of net (the card then says "Revenue", not "Net revenue"). */
  gross?: boolean;
  /** Payments/orders/sales behind the number. */
  count?: number;
  /** The provider stopped paging early; the number may be low. */
  capped?: boolean;
}

export interface UpcomingItem {
  /** YYYY-MM-DD */
  date: string;
  title: string;
  kind: "payout" | "renewal" | "milestone";
  amount?: number;
  currency?: string;
}

export interface RevenueProvider {
  /** "stripe" -> widgets "finance.stripe" and "finance.stripe-chart". */
  id: string;
  name: string;
  /** Tile label when `name` is long ("Dodo" for "Dodo Payments"). */
  short?: string;
  glyph: Glyph;
  dashboardUrl: string;
  account: Account;
  countLabel: string;
  fetch: (ctx: Ctx, range: { start: Date; end: Date }) => Promise<ProviderResult>;
  fetchUpcoming?: (ctx: Ctx, data: RevenueData) => Promise<UpcomingItem[]>;
  sample: { base: number; currency: string; perOrder: number };
}

export interface RevenueData {
  /** FETCH_DAYS days, oldest first, in `currency`. */
  days: DailyPoint[];
  currency: string;
  /** Currencies seen but not added (no conversion). */
  others: string[];
  testMode: boolean;
  gross: boolean;
  count?: number;
  capped?: boolean;
  upcoming?: UpcomingItem[];
}

/** Minor-unit factor for a currency (100 for USD, 1 for JPY). */
export function minorFactor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

export function entryDay(at: number | string): string {
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00/.test(at)) return at.slice(0, 10);
  const ms = typeof at === "number" ? at : Date.parse(at.replace(" ", "T"));
  return dayKey(new Date(ms));
}

/** Buckets entries into the given days; keeps the currency with the largest total. */
export function bucket(result: ProviderResult, days: string[] = lastDays(FETCH_DAYS)): RevenueData {
  const byCur = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  const inRange = new Set(days);
  for (const e of result.entries) {
    const day = entryDay(e.at);
    if (!inRange.has(day) || !Number.isFinite(e.amount)) continue;
    const cur = (e.currency || "USD").toUpperCase();
    let m = byCur.get(cur);
    if (!m) byCur.set(cur, (m = new Map()));
    m.set(day, (m.get(day) ?? 0) + e.amount);
    totals.set(cur, (totals.get(cur) ?? 0) + Math.abs(e.amount));
  }
  let currency = "USD";
  let best = -1;
  for (const [cur, t] of totals) {
    if (t > best) {
      best = t;
      currency = cur;
    }
  }
  const chosen = byCur.get(currency) ?? new Map<string, number>();
  return {
    days: days.map((date) => ({ date, net: round2(chosen.get(date) ?? 0), currency })),
    currency,
    others: [...totals.keys()].filter((c) => c !== currency),
    testMode: Boolean(result.testMode),
    gross: Boolean(result.gross),
    count: result.count,
    capped: result.capped,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface RevenueSummary {
  today: number;
  week: number;
  prevWeek: number;
  weekChange?: number;
  month: number;
  /** Month to date (calendar month). */
  mtd: number;
  chart: number[];
  chartDays: string[];
}

export function summarize(days: DailyPoint[]): RevenueSummary {
  const nets = days.map((d) => d.net);
  const sum = (a: number[]) => round2(a.reduce((x, y) => x + y, 0));
  const n = nets.length;
  const week = sum(nets.slice(Math.max(0, n - 7)));
  const prevWeek = sum(nets.slice(Math.max(0, n - 14), Math.max(0, n - 7)));
  const monthPrefix = dayKey(new Date()).slice(0, 7);
  return {
    today: n ? nets[n - 1] : 0,
    week,
    prevWeek,
    weekChange: prevWeek !== 0 ? ((week - prevWeek) / Math.abs(prevWeek)) * 100 : undefined,
    month: sum(nets.slice(Math.max(0, n - 30))),
    mtd: sum(days.filter((d) => d.date.startsWith(monthPrefix)).map((d) => d.net)),
    chart: nets.slice(Math.max(0, n - 14)),
    chartDays: days.slice(Math.max(0, n - 14)).map((d) => d.date),
  };
}

export function sampleRevenue(p: Pick<RevenueProvider, "id" | "sample">): RevenueData {
  const days = lastDays(FETCH_DAYS);
  const values = sampleSeries(`rev:${p.id}`, days.length, p.sample.base, { noise: 0.45, trend: 0.3 });
  const total = values.reduce((a, b) => a + b, 0);
  return {
    days: days.map((date, i) => ({ date, net: values[i], currency: p.sample.currency })),
    currency: p.sample.currency,
    others: [],
    testMode: false,
    gross: false,
    count: Math.max(1, Math.round(total / p.sample.perOrder)),
  };
}

export async function loadRevenue(p: RevenueProvider): Promise<RevenueData> {
  const ctx = liveCtx(p.account);
  const start = startOfDay(FETCH_DAYS - 1);
  const result = await p.fetch(ctx, { start, end: new Date() });
  const data = bucket(result);
  if (p.fetchUpcoming) {
    try {
      data.upcoming = await p.fetchUpcoming(ctx, data);
      publishCalendar(p.id, p.name, data.upcoming);
    } catch {
      /* optional extra; the revenue numbers still count */
    }
  }
  return data;
}

export function revenueKey(p: Pick<RevenueProvider, "account">): string {
  return `${p.account.ns}:revenue`;
}

/** The provider's data: sample numbers until connected, then the cached 15-minute poll. */
export function useRevenue(p: RevenueProvider, isSample: boolean): { data: RevenueData | undefined; poll: Polled<RevenueData> } {
  const poll = usePolled<RevenueData>(isSample ? null : revenueKey(p), () => loadRevenue(p), { refreshMs: REVENUE_REFRESH_MS });
  if (isSample) return { data: sampleRevenue(p), poll };
  return { data: poll.data, poll };
}

// ---- calendar ------------------------------------------------------------------------------

export interface CalendarFeed {
  updatedAt: number;
  items: Array<UpcomingItem & { source: string; sourceName: string }>;
}

/** Store key other slices can read: payouts, renewals and milestones from every store. */
export const CALENDAR_STORE_KEY = "finance.calendar";

/**
 * Publishes upcoming money events. Always written to the store key above; also handed to the
 * productivity slice's calendar sources registry when one exists (looked up lazily, so this
 * builds whether or not that slice ships one).
 */
export function publishCalendar(source: string, sourceName: string, items: UpcomingItem[]): void {
  const cur = getStored<CalendarFeed>(CALENDAR_STORE_KEY, { updatedAt: 0, items: [] });
  const next: CalendarFeed = {
    updatedAt: Date.now(),
    items: [...cur.items.filter((i) => i.source !== source), ...items.map((i) => ({ ...i, source, sourceName }))],
  };
  setStored(CALENDAR_STORE_KEY, next);
  withCalendar((cal) =>
    cal.set(
      `finance.${source}`,
      items.map((i, n) => {
        const [y, m, d] = i.date.split("-").map(Number);
        return {
          id: `${i.kind}:${i.date}:${n}`,
          title: i.title,
          start: new Date(y, m - 1, d).getTime(),
          allDay: true,
          kind: i.kind,
          source: sourceName,
          detail: i.amount !== undefined && i.kind !== "milestone" ? money(i.amount, i.currency ?? "USD") : undefined,
        };
      }),
    ),
  );
}

/** Removes a store's items from the calendar (on disconnect). */
export function clearCalendar(source: string): void {
  const cur = getStored<CalendarFeed>(CALENDAR_STORE_KEY, { updatedAt: 0, items: [] });
  setStored(CALENDAR_STORE_KEY, { updatedAt: Date.now(), items: cur.items.filter((i) => i.source !== source) });
  withCalendar((cal) => cal.clear(`finance.${source}`));
}

interface CalendarRegistry {
  set: (sourceId: string, items: Array<{ id: string; title: string; start: number; allDay?: boolean; kind: UpcomingItem["kind"]; source?: string; detail?: string }>) => void;
  clear: (sourceId: string) => void;
}

/** The productivity slice's calendar sources registry, loaded lazily if it exists. */
function withCalendar(fn: (cal: CalendarRegistry) => void): void {
  const mods = import.meta.glob("../../productivity/calendar/sources.ts");
  for (const load of Object.values(mods)) {
    load()
      .then((mod) => {
        const cal = (mod as { calendarSources?: CalendarRegistry }).calendarSources;
        if (cal && typeof cal.set === "function") fn(cal);
      })
      .catch(() => {});
  }
}
