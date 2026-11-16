import { useState } from "react";
import { Bitcoin, RefreshCw } from "lucide-react";
import { siBinance, siBitcoin, siCardano, siDogecoin, siEthereum, siLitecoin, siPolygon, siSolana, siTether, siXrp } from "simple-icons";
import { relativeTime, shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { AreaChart, CardFrame, cx, ErrorState, IconButton, Section, Sparkline, TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { cryptoMessage, fetchTickers, isDollar, splitPair, useCrypto } from "../binance";
import { parseSymbols } from "../finnhub";
import { changeColor, fmtPct, fmtPrice } from "../shared";
import { TickerField } from "../StocksConnect";

type CryptoConfig = { pairs: string[] };

const GLYPHS: Record<string, { path: string; hex: string }> = {
  BTC: siBitcoin,
  ETH: siEthereum,
  SOL: siSolana,
  BNB: siBinance,
  DOGE: siDogecoin,
  XRP: siXrp,
  ADA: siCardano,
  LTC: siLitecoin,
  USDT: siTether,
  POL: siPolygon,
  MATIC: siPolygon,
};

function CoinGlyph({ base, size }: { base: string; size: number }) {
  const g = GLYPHS[base];
  if (!g) {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-accent/20 font-bold text-accent" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
        {base.slice(0, 1)}
      </span>
    );
  }
  const n = parseInt(g.hex, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden>
      <path d={g.path} fill={lum < 0.3 ? "currentColor" : `#${g.hex}`} />
    </svg>
  );
}

function pairsOf(config: CryptoConfig): string[] {
  const list = parseSymbols((Array.isArray(config.pairs) ? config.pairs : ["BTCUSDT"]).join(","), 3);
  return list.length ? list : ["BTCUSDT"];
}

function price(pair: string, p: number | undefined): string {
  const [, quote] = splitPair(pair);
  return isDollar(quote) ? `$${fmtPrice(p)}` : `${fmtPrice(p)}${quote ? ` ${quote}` : ""}`;
}

/** Short prices for the multi-pair tile: 64.6k, 1,811, 71.84, 0.3921. */
function tilePrice(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return "–";
  if (p >= 10_000) return `${(p / 1000).toFixed(1)}k`;
  if (p >= 1000) return Math.round(p).toLocaleString();
  return fmtPrice(p);
}

function CryptoTile({ config, size, isSample }: TileProps<CryptoConfig>) {
  const pairs = pairsOf(config);
  const { tickers, lines } = useCrypto(pairs, isSample);
  const small = Math.max(9, Math.round(size * 0.2));
  if (pairs.length === 1) {
    const p = pairs[0];
    const t = tickers[p];
    const [base] = splitPair(p);
    const color = changeColor(t?.changePct);
    return (
      <TileFrame className="gap-[calc(var(--tile-h)*0.12)]" title={t ? `${p} ${price(p, t.price)} (${fmtPct(t.changePct)} in 24 h)` : p}>
        <CoinGlyph base={base} size={Math.round(size * 0.42)} />
        <div className="min-w-0 shrink-0 leading-none">
          <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.29) }}>
            {t ? price(p, t.price) : "–"}
          </div>
          <div className="mt-[3px] font-medium tabular-nums" style={{ fontSize: small, color }}>
            {base} {fmtPct(t?.changePct)}
          </div>
        </div>
        <div className="min-w-0 flex-1">{(lines[p]?.length ?? 0) > 1 ? <Sparkline data={lines[p]} height={Math.round(size * 0.46)} color={color} strokeWidth={1.6} /> : null}</div>
        {isSample && <TileSampleBadge size={size} />}
      </TileFrame>
    );
  }
  return (
    <TileFrame className="justify-between gap-[calc(var(--tile-h)*0.08)] px-[calc(var(--tile-h)*0.16)]">
      {pairs.map((p, i) => {
        const t = tickers[p];
        const [base] = splitPair(p);
        return (
          <div key={p} className={cx("flex min-w-0 flex-1 flex-col leading-none", i > 0 && "border-l border-line pl-[calc(var(--tile-h)*0.12)]")} title={t ? `${p} ${price(p, t.price)}` : p}>
            <span className="flex items-center gap-[3px] truncate font-semibold text-dim" style={{ fontSize: small }}>
              <CoinGlyph base={base} size={small} />
              {base}
            </span>
            <span className="mt-[3px] truncate font-semibold tabular-nums" style={{ fontSize: Math.max(10, Math.round(size * 0.24)) }}>
              {tilePrice(t?.price)}
            </span>
            <span className="mt-[2px] font-medium tabular-nums" style={{ fontSize: small, color: changeColor(t?.changePct) }}>
              {fmtPct(t?.changePct)}
            </span>
          </div>
        );
      })}
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function CryptoCard({ config, setConfig, isSample }: CardProps<CryptoConfig>) {
  const pairs = pairsOf(config);
  const { tickers, lines, error, loading, refresh } = useCrypto(pairs, isSample);
  const [saveError, setSaveError] = useState<string | null>(null);
  const updated = Math.max(0, ...pairs.map((p) => tickers[p]?.fetchedAt ?? 0));
  const save = async (next: string[]) => {
    setSaveError(null);
    try {
      if (!isSample) await fetchTickers(next);
      setConfig({ pairs: next });
    } catch (e) {
      setSaveError(cryptoMessage(e));
    }
  };
  return (
    <CardFrame
      title="Crypto"
      subtitle={isSample ? "Sample prices" : updated ? `Binance · updated ${relativeTime(updated)}` : "Binance"}
      icon={Bitcoin}
      actions={!isSample && <IconButton icon={RefreshCw} label="Refresh" onClick={refresh} className={cx(loading && "animate-spin")} />}
    >
      {pairs.map((p) => {
        const t = tickers[p];
        const [base, quote] = splitPair(p);
        const color = changeColor(t?.changePct);
        const line = lines[p] ?? [];
        return (
          <div key={p} className="mb-3 rounded-xl bg-input px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CoinGlyph base={base} size={20} />
              <span className="text-[13px] font-semibold">
                {base}
                <span className="font-normal text-faint">/{quote}</span>
              </span>
              <span className="ml-auto text-[16px] font-semibold tabular-nums">{t ? price(p, t.price) : "–"}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums">
              <span className="shrink-0 font-medium" style={{ color }}>
                {fmtPct(t?.changePct)} <span className="font-normal text-faint">24 h</span>
              </span>
              {t && (
                <span className="truncate text-faint">
                  {fmtPrice(t.low)} – {fmtPrice(t.high)} · vol {shortNumber(t.volume)}
                </span>
              )}
            </div>
            {line.length > 1 && <AreaChart data={line} height={56} color={color} className="mt-2" />}
          </div>
        );
      })}
      {error && <ErrorState className="mb-3" message={`${error} Prices below are from the last update.`} onRetry={refresh} />}
      <Section title="Pairs (up to 3)" className="mb-0">
        <TickerField symbols={pairs} max={3} onSave={(next) => void save(next)} />
        {saveError && <div className="pb-2.5 text-[12px] text-bad">{saveError}</div>}
      </Section>
    </CardFrame>
  );
}

export default defineWidget<CryptoConfig>({
  id: "stocks.crypto",
  name: "Crypto",
  category: "Stocks",
  description: "Live Binance prices for up to three coins, with 24-hour change.",
  keywords: ["crypto", "bitcoin", "btc", "ethereum", "binance", "coin", "price"],
  icon: Bitcoin,
  size: "l",
  Tile: CryptoTile,
  Card: CryptoCard,
  cardSize: { width: 330 },
  defaultConfig: { pairs: ["BTCUSDT"] },
});
