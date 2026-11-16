/**
 * Binance public market data (no key): 24-hour tickers and the day's 15-minute closes.
 * api.binance.com is blocked in some countries; the official public-data mirror is tried next.
 */
import { useCallback, useEffect, useState } from "react";
import { describeError, HttpError, httpJson } from "../../core/http";
import { getStored, setStored, useStored } from "../../core/store";
import { useInterval, useIsVisible } from "../../core/useVisible";

const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];
let host = 0;
const TICKER_MS = 60_000;
const LINE_MS = 15 * 60_000;
const KEY = "stocks.crypto";

export interface CoinTicker {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  /** 24 h volume in the quote asset. */
  volume: number;
  fetchedAt: number;
}

interface CryptoCache {
  tickers: Record<string, CoinTicker>;
  lines: Record<string, { at: number; closes: number[] }>;
}

const QUOTES = ["FDUSD", "USDT", "USDC", "TUSD", "BUSD", "BTC", "ETH", "BNB", "EUR", "GBP", "TRY", "BRL", "JPY", "AUD", "DAI"];

/** "BTCUSDT" -> ["BTC", "USDT"] */
export function splitPair(pair: string): [string, string] {
  const q = QUOTES.find((x) => pair.endsWith(x) && pair.length > x.length);
  return q ? [pair.slice(0, -q.length), q] : [pair, ""];
}

export function isDollar(quote: string): boolean {
  return ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USD"].includes(quote);
}

async function get<T>(path: string, query: Record<string, string | number>): Promise<T> {
  try {
    return await httpJson<T>(HOSTS[host] + path, { query, timeoutMs: 12_000 });
  } catch (e) {
    // 451/403: not available from here. Try the other host once.
    if (e instanceof HttpError && (e.status === 451 || e.status === 403)) {
      host = (host + 1) % HOSTS.length;
      return httpJson<T>(HOSTS[host] + path, { query, timeoutMs: 12_000 });
    }
    throw e;
  }
}

export function cryptoMessage(e: unknown): string {
  if (e instanceof HttpError && e.status === 400) return "One of those pairs is not on Binance. Write pairs like BTCUSDT.";
  return describeError(e);
}

interface RawTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
}

export async function fetchTickers(pairs: string[]): Promise<CoinTicker[]> {
  const raw = await get<RawTicker[]>("/api/v3/ticker/24hr", { symbols: JSON.stringify(pairs) });
  const now = Date.now();
  return raw.map((r) => ({
    symbol: r.symbol,
    price: Number(r.lastPrice),
    changePct: Number(r.priceChangePercent),
    high: Number(r.highPrice),
    low: Number(r.lowPrice),
    volume: Number(r.quoteVolume),
    fetchedAt: now,
  }));
}

export async function fetchLine(pair: string): Promise<number[]> {
  const raw = await get<Array<Array<number | string>>>("/api/v3/klines", { symbol: pair, interval: "15m", limit: 96 });
  return raw.map((k) => Number(k[4])).filter((n) => Number.isFinite(n));
}

let inflight: Promise<void> | null = null;

async function refresh(pairs: string[], force: boolean): Promise<void> {
  const cache = getStored<CryptoCache>(KEY, { tickers: {}, lines: {} });
  const now = Date.now();
  const stale = pairs.filter((p) => force || !cache.tickers[p] || now - cache.tickers[p].fetchedAt > TICKER_MS - 2_000);
  const lineStale = pairs.filter((p) => force || !cache.lines[p] || now - cache.lines[p].at > LINE_MS);
  if (!stale.length && !lineStale.length) return;
  const tickers = stale.length ? await fetchTickers(stale) : [];
  const lines = await Promise.all(lineStale.map(async (p) => [p, await fetchLine(p).catch(() => null)] as const));
  const next = getStored<CryptoCache>(KEY, { tickers: {}, lines: {} });
  const out: CryptoCache = { tickers: { ...next.tickers }, lines: { ...next.lines } };
  for (const t of tickers) out.tickers[t.symbol] = t;
  for (const [p, closes] of lines) if (closes) out.lines[p] = { at: now, closes };
  setStored(KEY, out);
}

export interface CryptoView {
  tickers: Record<string, CoinTicker | undefined>;
  lines: Record<string, number[]>;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Prices for up to three pairs, once a minute while visible; the last prices stay offline. */
export function useCrypto(pairs: string[], sample: boolean): CryptoView {
  const [cache] = useStored<CryptoCache>(KEY, { tickers: {}, lines: {} });
  const visible = useIsVisible();
  const active = !sample && visible && pairs.length > 0;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = pairs.join(",");

  const run = useCallback(
    (force = false) => {
      if (!key || inflight) return;
      setLoading(true);
      inflight = refresh(key.split(","), force)
        .then(() => setError(null))
        .catch((e) => setError(cryptoMessage(e)))
        .finally(() => {
          inflight = null;
          setLoading(false);
        });
    },
    [key],
  );
  useEffect(() => {
    if (!active) return;
    run();
    const onOnline = () => run(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [active, run]);
  useInterval(() => run(), active ? TICKER_MS : null);

  if (sample) return sampleCrypto(pairs);
  const tickers: Record<string, CoinTicker | undefined> = {};
  const lines: Record<string, number[]> = {};
  for (const p of pairs) {
    tickers[p] = cache.tickers[p];
    lines[p] = cache.lines[p]?.closes ?? [];
  }
  return { tickers, lines, error, loading, refresh: () => run(true) };
}

const SAMPLE_PRICES: Record<string, [number, number]> = {
  BTCUSDT: [97_412.5, 2.31],
  ETHUSDT: [3_412.18, -1.12],
  SOLUSDT: [212.44, 4.86],
  BNBUSDT: [664.2, 0.42],
  XRPUSDT: [2.4123, -0.85],
  DOGEUSDT: [0.3921, 3.4],
};

function sampleCrypto(pairs: string[]): CryptoView {
  const tickers: Record<string, CoinTicker> = {};
  const lines: Record<string, number[]> = {};
  pairs.forEach((p, idx) => {
    const [price, pct] = SAMPLE_PRICES[p] ?? [10 + idx, 1.2];
    const open = price / (1 + pct / 100);
    let x = 7 + idx * 13;
    const rand = () => {
      x = (x * 48271) % 2147483647;
      return x / 2147483647;
    };
    const closes: number[] = [];
    let v = open;
    for (let i = 0; i < 96; i++) {
      v += ((open + ((price - open) * i) / 95 - v) * 0.2 + (rand() - 0.5) * Math.abs(price - open) * 0.25);
      closes.push(v);
    }
    closes[95] = price;
    tickers[p] = { symbol: p, price, changePct: pct, high: Math.max(...closes), low: Math.min(...closes), volume: price * 18_000, fetchedAt: Date.now() };
    lines[p] = closes;
  });
  return { tickers, lines, error: null, loading: false, refresh: () => {} };
}
