import { HttpError, httpJson } from "../../../core/http";
import { shortNumber } from "../../../core/format";
import { guard, vendorDetail, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import { dayKey, lastDays, sampleSeries, startOfDay } from "../../finance/shared/sample";
import type { SeriesData } from "../../finance/shared/series";

export interface ResendEmail {
  id: string;
  created_at: string;
  last_event?: string;
  subject?: string;
  to?: string[];
}
export interface ResendList<T> {
  object: "list";
  has_more?: boolean;
  data: T[];
}

const NAME = "Resend";
const API = "https://api.resend.com";
export const RESEND_CAP = 1000;
const SEND_ONLY = "The key may only send mail, not read it. Make a new Resend key with Full access.";
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "2026-04-03 22:13:42.674981+00" (Postgres style) -> ms. */
export function parseResendDate(s: string): number {
  let iso = s.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(iso)) iso += ":00";
  return Date.parse(iso);
}

async function req<T>(ctx: Ctx, path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  try {
    return await httpJson<T>(`${API}${path}`, { headers: auth(ctx), query });
  } catch (e) {
    // A sending-only key is rejected with name "restricted_api_key": say so instead of "rejected".
    if (e instanceof HttpError && /restricted|only send/i.test(`${vendorDetail(e.detail)} ${e.detail ?? ""}`)) throw new PlainError(SEND_ONLY);
    return guard<T>(NAME, () => Promise.reject(e));
  }
}

export function resendSeries(emails: ResendEmail[], days: string[], capped: boolean, domains: Array<{ name: string; status: string }> = []): SeriesData {
  const counts = new Map<string, number>();
  const ev = new Map<string, number>();
  const today = days[days.length - 1];
  const weekDays = new Set(days.slice(-7));
  let weekTotal = 0;
  for (const e of emails) {
    const day = dayKey(new Date(parseResendDate(e.created_at)));
    counts.set(day, (counts.get(day) ?? 0) + 1);
    if (weekDays.has(day)) {
      weekTotal++;
      const k = e.last_event ?? "sent";
      ev.set(k, (ev.get(k) ?? 0) + 1);
    }
  }
  const values = days.map((d) => counts.get(d) ?? 0);
  // Opened and clicked emails were delivered first.
  const delivered = (ev.get("delivered") ?? 0) + (ev.get("opened") ?? 0) + (ev.get("clicked") ?? 0);
  const opened = (ev.get("opened") ?? 0) + (ev.get("clicked") ?? 0);
  const pct = (n: number) => (weekTotal ? `${Math.round((n / weekTotal) * 100)}%` : "–");
  return {
    days,
    values,
    stats: [
      { label: "Today", value: shortNumber(counts.get(today) ?? 0) },
      { label: "Delivered · 7d", value: pct(delivered), sub: `${delivered.toLocaleString()} emails` },
      { label: "Opened · 7d", value: pct(opened) },
      { label: "Bounced", value: shortNumber(ev.get("bounced") ?? 0) },
      { label: "Spam reports", value: shortNumber(ev.get("complained") ?? 0) },
      { label: "Failed", value: shortNumber((ev.get("failed") ?? 0) + (ev.get("suppressed") ?? 0)) },
    ],
    rowsTitle: domains.length ? "Domains" : undefined,
    rows: domains.slice(0, 5).map((d) => ({ title: d.name, right: d.status === "verified" ? "Verified" : d.status.replace(/_/g, " ") })),
    note: capped ? `High volume: the count covers only your newest ${RESEND_CAP.toLocaleString()} emails (1,000+).` : undefined,
  };
}

export async function loadResend(ctx: Ctx): Promise<SeriesData> {
  const days = lastDays(14);
  const startMs = startOfDay(13).getTime();
  const emails: ResendEmail[] = [];
  let after: string | undefined;
  let capped = false;
  for (let page = 0; page < RESEND_CAP / 100; page++) {
    if (page > 0) await sleep(550); // Resend allows two requests a second
    const res = await req<ResendList<ResendEmail>>(ctx, "/emails", { limit: 100, after });
    const data = res.data ?? [];
    emails.push(...data);
    const oldest = data[data.length - 1];
    if (!res.has_more || !oldest || parseResendDate(oldest.created_at) < startMs) break;
    after = oldest.id;
    if (page === RESEND_CAP / 100 - 1) capped = true;
  }
  let domains: Array<{ name: string; status: string }> = [];
  try {
    await sleep(550);
    domains = (await req<ResendList<{ name: string; status: string }>>(ctx, "/domains")).data ?? [];
  } catch {
    /* optional */
  }
  return resendSeries(emails, days, capped, domains);
}

export function sampleResend(): SeriesData {
  const days = lastDays(14);
  const values = sampleSeries("resend", 14, 118, { integer: true, noise: 0.3 });
  return {
    days,
    values,
    stats: [
      { label: "Today", value: shortNumber(values[13]) },
      { label: "Delivered · 7d", value: "98%", sub: "812 emails" },
      { label: "Opened · 7d", value: "46%" },
      { label: "Bounced", value: "9" },
      { label: "Spam reports", value: "1" },
      { label: "Failed", value: "2" },
    ],
    rowsTitle: "Domains",
    rows: [
      { title: "mail.example.com", right: "Verified" },
      { title: "example.com", right: "Verified" },
    ],
  };
}

export const resendAccount: Account = {
  ns: "developer.resend",
  name: NAME,
  ids: ["developer.resend"],
  spec: {
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "re_…", help: "Needs Full access; with Sending access the key cannot list your emails." }],
    guide: { steps: ["In Resend, go to API Keys and press Create API Key.", "Choose Full access as the permission.", "Copy the re_… key."], url: "https://resend.com/api-keys", linkLabel: "Open Resend API keys" },
    test: async (values) => {
      await req({ secret: (f) => values[f] ?? "", settings: values, testing: true }, "/emails", { limit: 1 });
    },
  },
};
