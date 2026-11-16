/** Hooks and formatting shared by the stock and crypto widgets. */
import { useCallback, useEffect, useState } from "react";
import { useStored } from "../../core/store";
import { useInterval, useIsVisible } from "../../core/useVisible";
import { finnhubMessage, QUOTE_REFRESH_MS, refreshQuote, sampleQuote, type Intraday, type Quote } from "./finnhub";

export interface QuotesView {
  quotes: Record<string, Quote | undefined>;
  /** Today's line per symbol (oldest first). */
  lines: Record<string, number[]>;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Quotes for `symbols`: sample numbers until connected, otherwise Finnhub once a minute while
 * visible, keeping the last price when a refresh fails.
 */
export function useQuotes(symbols: string[], sample: boolean): QuotesView {
  const [stored] = useStored<Record<string, Quote>>("stocks.quotes", {});
  const [intraday] = useStored<Record<string, Intraday>>("stocks.intraday", {});
  const visible = useIsVisible();
  const active = !sample && visible && symbols.length > 0;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = symbols.join(",");

  const run = useCallback(
    (force = false) => {
      if (!key) return;
      setLoading(true);
      Promise.allSettled(key.split(",").map((s) => refreshQuote(s, force))).then((results) => {
        const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        setError(failed ? finnhubMessage(failed.reason) : null);
        setLoading(false);
      });
    },
    [key],
  );

  useEffect(() => {
    if (!active) return;
    run();
    // Connection restored (for example after sleep): refresh right away.
    const onOnline = () => run(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [active, run]);
  useInterval(() => run(), active ? QUOTE_REFRESH_MS : null);

  if (sample) {
    const quotes: Record<string, Quote> = {};
    const lines: Record<string, number[]> = {};
    for (const s of symbols) {
      const q = sampleQuote(s);
      quotes[s] = q.quote;
      lines[s] = q.line;
    }
    return { quotes, lines, error: null, loading: false, refresh: () => {} };
  }
  const quotes: Record<string, Quote | undefined> = {};
  const lines: Record<string, number[]> = {};
  for (const s of symbols) {
    quotes[s] = stored[s];
    lines[s] = (intraday[s]?.points ?? []).map((p) => p[1]);
  }
  return { quotes, lines, error, loading, refresh: () => run(true) };
}

/** 231.42, 1,234.5, 0.1834 */
export function fmtPrice(p: number | undefined, opts: { currency?: string } = {}): string {
  if (p === undefined || !Number.isFinite(p)) return "–";
  const a = Math.abs(p);
  const digits = a >= 10_000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const n = p.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return opts.currency === "USD" ? `$${n}` : n;
}

export function fmtPct(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) return "–";
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%`;
}

export function changeColor(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v) || v === 0) return "var(--g-dim)";
  return v > 0 ? "var(--g-good)" : "var(--g-bad)";
}

/** US tickers (no exchange suffix) are quoted in dollars. */
export function stockCurrency(symbol: string): string | undefined {
  return symbol.includes(".") || symbol.includes(":") ? undefined : "USD";
}
