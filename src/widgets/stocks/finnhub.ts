/**
 * Finnhub for the stock widgets. One key serves both widgets ("stocks.finnhub.apiKey" in
 * Credential Manager); requests go through Rust, which substitutes the key.
 *
 * - Quotes refresh at most once a minute per ticker while a tile shows it; the last answer is
 *   kept (`stocks.quotes`), so tiles keep their price offline and after a restart.
 * - The intraday line comes from Finnhub candles when the plan allows it; on the free plan
 *   (candles are premium there) it is drawn from the quotes seen today.
 */
import { setConnected } from "../../core/connections";
import { HttpError, httpJson } from "../../core/http";
import { secretRef, secrets } from "../../core/secrets";
import { getStored, setStored } from "../../core/store";

export const SECRET = "stocks.finnhub.apiKey";
export const STOCK_WIDGETS = ["stocks.chart", "stocks.watchlist"];
const BASE = "https://finnhub.io/api/v1";
export const QUOTE_REFRESH_MS = 60_000;

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  /** Unix ms of the last trade. */
  tradeAt: number;
  /** Unix ms we fetched it. */
  fetchedAt: number;
}

/** Points of today's line: [unix ms, price]. */
export interface Intraday {
  day: string;
  points: Array<[number, number]>;
  /** True when the points came from Finnhub candles. */
  candles: boolean;
}

const QUOTES_KEY = "stocks.quotes";
const INTRADAY_KEY = "stocks.intraday";
const CANDLES_KEY = "stocks.candlesForbiddenOn";

interface RawQuote {
  c: number;
  d: number | null;
  dp: number | null;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

export function parseSymbols(text: string, max = 5): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const s = normalizeSymbol(part);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, max);
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function toQuote(symbol: string, r: RawQuote): Quote {
  if (!r || typeof r.c !== "number") throw new HttpError("bad_response");
  if (r.c === 0 && r.t === 0) throw new Error(`Finnhub has no price for ${symbol}. Check the ticker.`);
  return {
    symbol,
    price: r.c,
    change: r.d ?? r.c - r.pc,
    changePct: r.dp ?? (r.pc ? ((r.c - r.pc) / r.pc) * 100 : 0),
    open: r.o,
    high: r.h,
    low: r.l,
    prevClose: r.pc,
    tradeAt: r.t * 1000,
    fetchedAt: Date.now(),
  };
}

/** Plain words for Finnhub errors. */
export function finnhubMessage(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.kind === "unauthorized" || e.kind === "forbidden") return "Finnhub refused this key. Copy the key shown on your Finnhub dashboard and try again.";
    if (e.kind === "rate_limited") return "Finnhub is limiting requests right now. Prices update again within a minute.";
    if (e.kind === "offline") return "No internet connection. The prices shown are the last ones loaded.";
    if (e.kind === "not_connected") return "Add your Finnhub key to start loading prices.";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Could not load prices.";
}

/** Checks a key with one real read, before it is saved. */
export async function testKey(key: string, symbol = "AAPL"): Promise<void> {
  const r = await httpJson<RawQuote>(`${BASE}/quote`, { query: { symbol }, headers: { "X-Finnhub-Token": key }, timeoutMs: 12_000 });
  toQuote(symbol, r);
}

export async function saveKey(key: string): Promise<void> {
  await secrets.set(SECRET, key);
  for (const id of STOCK_WIDGETS) setConnected(id, true);
}

export async function forgetKey(): Promise<void> {
  await secrets.delete(SECRET).catch(() => {});
  for (const id of STOCK_WIDGETS) setConnected(id, false);
}

export function cachedQuotes(): Record<string, Quote> {
  return getStored<Record<string, Quote>>(QUOTES_KEY, {});
}

export function cachedIntraday(): Record<string, Intraday> {
  return getStored<Record<string, Intraday>>(INTRADAY_KEY, {});
}

const inflight = new Map<string, Promise<Quote>>();

/** Fetches a quote unless one from the last minute is cached; records it on today's line. */
export function refreshQuote(symbol: string, force = false): Promise<Quote> {
  const cached = cachedQuotes()[symbol];
  if (!force && cached && Date.now() - cached.fetchedAt < QUOTE_REFRESH_MS - 2_000) return Promise.resolve(cached);
  const running = inflight.get(symbol);
  if (running) return running;
  const p = httpJson<RawQuote>(`${BASE}/quote`, { query: { symbol }, headers: { "X-Finnhub-Token": secretRef(SECRET) }, timeoutMs: 12_000 })
    .then((r) => {
      const q = toQuote(symbol, r);
      setStored(QUOTES_KEY, { ...cachedQuotes(), [symbol]: q });
      void recordPoint(q);
      return q;
    })
    .finally(() => inflight.delete(symbol));
  inflight.set(symbol, p);
  return p;
}

async function recordPoint(q: Quote): Promise<void> {
  const day = localDay(q.tradeAt || Date.now());
  const all = cachedIntraday();
  let line = all[q.symbol];
  if (!line || line.day !== day) {
    line = { day, points: [], candles: false };
    const fromCandles = await tryCandles(q.symbol);
    if (fromCandles) line = { day, points: fromCandles, candles: true };
    else if (q.open) line.points.push([Date.now() - 1000, q.open]);
  }
  const last = line.points[line.points.length - 1];
  if (!last || last[1] !== q.price || Date.now() - last[0] > 5 * 60_000) line.points.push([Date.now(), q.price]);
  if (line.points.length > 420) line.points = line.points.slice(-420);
  setStored(INTRADAY_KEY, { ...cachedIntraday(), [q.symbol]: line });
}

/** Today's 5-minute candles, or null when the plan has no candles (checked once a day). */
async function tryCandles(symbol: string): Promise<Array<[number, number]> | null> {
  const today = localDay(Date.now());
  if (getStored<string>(CANDLES_KEY, "") === today) return null;
  const to = Math.floor(Date.now() / 1000);
  const from = to - 16 * 3600;
  try {
    const r = await httpJson<{ s: string; c?: number[]; t?: number[] }>(`${BASE}/stock/candle`, {
      query: { symbol, resolution: 5, from, to },
      headers: { "X-Finnhub-Token": secretRef(SECRET) },
      timeoutMs: 12_000,
    });
    if (r.s !== "ok" || !r.c || !r.t) return null;
    return r.t.map((t, i) => [t * 1000, r.c![i]] as [number, number]);
  } catch (e) {
    if (e instanceof HttpError && (e.kind === "forbidden" || e.kind === "unauthorized")) setStored(CANDLES_KEY, today);
    return null;
  }
}

// ---- sample data -------------------------------------------------------------------------------

const SAMPLES: Record<string, { price: number; prev: number; seed: number }> = {
  AAPL: { price: 231.42, prev: 228.9, seed: 3 },
  MSFT: { price: 448.17, prev: 451.02, seed: 7 },
  NVDA: { price: 142.66, prev: 138.21, seed: 11 },
  TSLA: { price: 318.35, prev: 322.4, seed: 5 },
  AMZN: { price: 204.08, prev: 202.77, seed: 13 },
  GOOGL: { price: 176.51, prev: 175.9, seed: 17 },
  META: { price: 588.3, prev: 581.12, seed: 19 },
};

/** A deterministic, believable day for a sample ticker. */
export function sampleQuote(symbol: string): { quote: Quote; line: number[] } {
  const s = SAMPLES[symbol] ?? { price: 100 + (symbol.charCodeAt(0) % 50), prev: 99 + (symbol.charCodeAt(0) % 50), seed: symbol.length };
  let x = s.seed;
  const rand = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const n = 60;
  const line: number[] = [];
  let v = s.prev + (s.price - s.prev) * 0.15;
  for (let i = 0; i < n; i++) {
    const target = s.prev + ((s.price - s.prev) * i) / (n - 1);
    v += (target - v) * 0.25 + (rand() - 0.5) * Math.abs(s.price - s.prev) * 0.35;
    line.push(Math.round(v * 100) / 100);
  }
  line[n - 1] = s.price;
  const high = Math.max(...line);
  const low = Math.min(...line);
  return {
    quote: { symbol, price: s.price, change: s.price - s.prev, changePct: ((s.price - s.prev) / s.prev) * 100, open: line[0], high, low, prevClose: s.prev, tradeAt: Date.now(), fetchedAt: Date.now() },
    line,
  };
}
