/**
 * Exchange rates from open.er-api.com (free, no key, ~160 currencies, updated daily), with
 * frankfurter.app as a fallback. Cached in the store with their date; refreshed every 6 hours
 * while a currency tile is visible.
 */
import { useEffect } from "react";
import { HttpError, httpJson } from "../../../core/http";
import { getStored, setStored, useStored } from "../../../core/store";
import { useInterval, useIsVisible } from "../../../core/useVisible";

export interface Rates {
  /** Units of each currency per 1 USD. */
  rates: Record<string, number>;
  /** When the provider last updated them (unix ms). */
  updatedAt: number;
  fetchedAt: number;
  provider: string;
}

const KEY = "productivity.currencyRates";
const MAX_AGE = 6 * 3600_000;
const RETRY = 10 * 60_000;

/** Rough rates for the preview before the first download. */
export const SAMPLE_RATES: Record<string, number> = {
  USD: 1, EUR: 0.925, GBP: 0.79, JPY: 154.2, CNY: 7.24, INR: 83.4, CAD: 1.37, AUD: 1.52, CHF: 0.88, SEK: 10.6, NOK: 10.8, DKK: 6.9,
  PLN: 3.98, CZK: 23.2, HUF: 362, RUB: 92, UAH: 41, TRY: 34.2, UZS: 12750, KZT: 495, BRL: 5.6, MXN: 18.1, ARS: 980, ZAR: 18.3,
  KRW: 1385, SGD: 1.34, HKD: 7.8, THB: 35.6, IDR: 15900, VND: 25400, PHP: 58.1, AED: 3.67, SAR: 3.75, ILS: 3.7, EGP: 48.6, NGN: 1650,
  NZD: 1.66, MYR: 4.45, PKR: 278, BDT: 120, GEL: 2.7, AMD: 388, AZN: 1.7, BYN: 3.27, KGS: 86.5, TJS: 10.6,
};

let inflight: Promise<void> | null = null;
let lastFail = 0;

interface ErApi {
  result: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
}

interface Frankfurter {
  rates?: Record<string, number>;
  date?: string;
}

async function download(): Promise<Rates> {
  try {
    const r = await httpJson<ErApi>("https://open.er-api.com/v6/latest/USD", { timeoutMs: 15_000 });
    if (r.result === "success" && r.rates && Object.keys(r.rates).length > 50) {
      return { rates: r.rates, updatedAt: (r.time_last_update_unix ?? Date.now() / 1000) * 1000, fetchedAt: Date.now(), provider: "open.er-api.com" };
    }
    throw new HttpError("bad_response");
  } catch (first) {
    try {
      const f = await httpJson<Frankfurter>("https://api.frankfurter.app/latest?from=USD", { timeoutMs: 15_000 });
      if (!f.rates) throw first;
      return { rates: { USD: 1, ...f.rates }, updatedAt: f.date ? Date.parse(f.date) : Date.now(), fetchedAt: Date.now(), provider: "frankfurter.app" };
    } catch {
      throw first;
    }
  }
}

export function refreshRates(force = false): Promise<void> {
  const cur = getStored<Rates | null>(KEY, null);
  if (!force && cur && Date.now() - cur.fetchedAt < MAX_AGE) return Promise.resolve();
  if (!force && Date.now() - lastFail < RETRY) return Promise.resolve();
  if (inflight) return inflight;
  inflight = download()
    .then((r) => setStored(KEY, r))
    .catch((e) => {
      lastFail = Date.now();
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The cached rates (refreshing them while visible), or null before the first download. */
export function useRates(enabled = true): { rates: Rates | null; refresh: () => Promise<void> } {
  const [rates] = useStored<Rates | null>(KEY, null);
  const visible = useIsVisible();
  useEffect(() => {
    if (enabled && visible) void refreshRates().catch(() => {});
  }, [enabled, visible]);
  // refreshRates() is a no-op until the cached rates are 6 h old.
  useInterval(() => void refreshRates().catch(() => {}), enabled ? 30 * 60_000 : null);
  return { rates, refresh: () => refreshRates(true) };
}

export function convert(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  const a = rates[from];
  const b = rates[to];
  if (!a || !b || !Number.isFinite(amount)) return null;
  return (amount / a) * b;
}

/** Readable amount: more decimals for small values (0.0123), none for huge ones. */
export function formatAmount(v: number, code: string, withCode = false): string {
  const abs = Math.abs(v);
  const digits = abs === 0 ? 2 : abs < 1 ? Math.min(6, 2 - Math.floor(Math.log10(abs)) + 1) : abs < 1000 ? 2 : abs < 100_000 ? 2 : 0;
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: abs >= 100_000 ? 0 : Math.min(2, digits), maximumFractionDigits: digits }).format(v);
  return withCode ? `${num} ${code}` : num;
}

/** Parses "1,234.5", "1 234,5", "12k". */
export function parseAmount(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return null;
  const mult = t.endsWith("k") ? 1e3 : t.endsWith("m") ? 1e6 : 1;
  let core = mult === 1 ? t : t.slice(0, -1);
  if (/,\d{1,2}$/.test(core) && !/\.\d/.test(core)) core = core.replace(/\./g, "").replace(",", ".");
  core = core.replace(/,/g, "");
  const n = Number(core);
  return Number.isFinite(n) ? n * mult : null;
}
