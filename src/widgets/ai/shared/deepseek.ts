/**
 * DeepSeek balance with a pasted key (GET /user/balance). DeepSeek reports only the balance, so
 * today's and this week's spend are worked out from how the balance falls between readings
 * (top-ups are ignored). Samples live under "ai.deepseek.samples" (amounts and times only).
 */
import { getStored, setStored } from "../../../core/store";
import { httpJson, HttpError } from "../../../core/http";
import { secretRef } from "../../../core/secrets";
import type { DeepSeekBalance } from "./types";

export const DEEPSEEK_SECRET = "ai.deepseek.apiKey";
const URL = "https://api.deepseek.com/user/balance";
const SAMPLES_KEY = "ai.deepseek.samples";
const DAY = 86_400_000;

export interface BalanceSample {
  at: number;
  balance: number;
  currency: string;
}

interface RawInfo {
  currency?: string;
  total_balance?: string | number;
  granted_balance?: string | number;
  topped_up_balance?: string | number;
}

const n = (v: unknown) => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : 0;
};

/** Pure: the API answer -> a balance (the first currency with money, else the first). */
export function parseBalance(body: unknown, now: number): DeepSeekBalance {
  const b = (body ?? {}) as { is_available?: boolean; balance_infos?: RawInfo[] };
  const infos = Array.isArray(b.balance_infos) ? b.balance_infos : [];
  if (!infos.length) throw new HttpError("bad_response", 200, "no balance in the answer");
  const pick = infos.find((i) => n(i.total_balance) > 0) ?? infos[0];
  return {
    available: b.is_available !== false,
    currency: pick.currency || "USD",
    total: n(pick.total_balance),
    granted: n(pick.granted_balance),
    toppedUp: n(pick.topped_up_balance),
    fetchedAt: now,
  };
}

/** Pure: adds a reading and keeps 8 days. An unchanged balance within 5 minutes is not stored twice. */
export function addSample(samples: BalanceSample[], s: BalanceSample): BalanceSample[] {
  const out = samples.filter((x) => x.currency === s.currency && x.at > s.at - 8 * DAY && x.at <= s.at);
  const last = out[out.length - 1];
  if (last && s.at - last.at < 5 * 60_000 && last.balance === s.balance) return out;
  return [...out, s].slice(-3000);
}

/** Pure: money spent (balance decreases) between readings taken in [since, until). */
export function spentSince(samples: BalanceSample[], since: number, until = Infinity): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (b.at < since || b.at >= until) continue;
    if (a.balance > b.balance) total += a.balance - b.balance;
  }
  return Math.round(total * 10000) / 10000;
}

export interface Pace {
  today: number;
  week: number;
  /** Average spend per day over what was observed (up to 7 days); null until 6 hours observed. */
  perDay: number | null;
  /** How many days the balance lasts at that pace; null when unknown or not spending. */
  daysLeft: number | null;
  /** Hours of history the numbers are based on. */
  observedHours: number;
}

export function pace(samples: BalanceSample[], balance: number, now: number, startOfToday: number): Pace {
  const today = spentSince(samples, startOfToday);
  const week = spentSince(samples, now - 7 * DAY);
  const first = samples.find((s) => s.at >= now - 7 * DAY);
  const observedMs = first ? now - first.at : 0;
  const observedHours = observedMs / 3_600_000;
  const perDay = observedHours >= 6 ? week / Math.min(7, observedMs / DAY) : null;
  const daysLeft = perDay && perDay > 0 ? balance / perDay : null;
  return { today, week, perDay, daysLeft, observedHours };
}

export function getSamples(): BalanceSample[] {
  return getStored<BalanceSample[]>(SAMPLES_KEY, []);
}

export function recordBalance(b: DeepSeekBalance): void {
  setStored(SAMPLES_KEY, addSample(getSamples(), { at: b.fetchedAt, balance: b.total, currency: b.currency }));
}

export function clearSamples(): void {
  setStored(SAMPLES_KEY, null);
}

export async function fetchDeepSeek(): Promise<DeepSeekBalance> {
  const body = await httpJson<unknown>(URL, { headers: { Authorization: `Bearer ${secretRef(DEEPSEEK_SECRET)}` } });
  return parseBalance(body, Date.now());
}

export async function testDeepSeekKey(key: string): Promise<void> {
  try {
    parseBalance(await httpJson<unknown>(URL, { headers: { Authorization: `Bearer ${key}` } }), Date.now());
  } catch (e) {
    if (e instanceof HttpError && (e.kind === "unauthorized" || e.kind === "forbidden")) {
      throw new Error("DeepSeek didn't accept this key. Make sure you copied all of it, or generate another one.");
    }
    throw e;
  }
}
