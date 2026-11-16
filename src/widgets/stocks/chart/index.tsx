import { CandlestickChart, RefreshCw } from "lucide-react";
import { relativeTime } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { AreaChart, CardFrame, cx, ErrorState, IconButton, Section, Skeleton, Sparkline, Stat, TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { normalizeSymbol, forgetKey } from "../finnhub";
import { changeColor, fmtPct, fmtPrice, stockCurrency, useQuotes } from "../shared";
import { DisconnectButton, StocksConnect, TickerField } from "../StocksConnect";

type ChartConfig = { symbol: string };

function ChartTile({ config, size, isSample }: TileProps<ChartConfig>) {
  const symbol = normalizeSymbol(config.symbol || "AAPL");
  const { quotes, lines } = useQuotes([symbol], isSample);
  const q = quotes[symbol];
  const line = lines[symbol] ?? [];
  const color = changeColor(q?.changePct);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.14)]" title={q ? `${symbol} ${fmtPrice(q.price)} (${fmtPct(q.changePct)})` : symbol}>
      <div className="min-w-0 shrink-0 leading-none">
        <div className="truncate font-semibold text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.21)) }}>
          {symbol}
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.3) }}>
          {q ? fmtPrice(q.price, { currency: stockCurrency(symbol) }) : "–"}
        </div>
        <div className="mt-[2px] font-medium tabular-nums" style={{ fontSize: Math.max(9, Math.round(size * 0.2)), color }}>
          {fmtPct(q?.changePct)}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {line.length > 1 ? <Sparkline data={line} height={Math.round(size * 0.5)} color={color} strokeWidth={1.6} /> : <div className="h-px w-full bg-track" />}
      </div>
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function ChartConnect({ config, setConfig }: CardProps<ChartConfig>) {
  return <StocksConnect symbols={[normalizeSymbol(config.symbol || "AAPL")]} max={1} onSymbols={(s) => setConfig({ symbol: s[0] })} />;
}

function ChartCard({ config, setConfig, isSample }: CardProps<ChartConfig>) {
  if (isSample) return <ChartConnect config={config} setConfig={setConfig} isSample instanceId="" close={() => {}} />;
  return <ChartDetails symbol={normalizeSymbol(config.symbol || "AAPL")} setSymbol={(s) => setConfig({ symbol: s })} />;
}

function ChartDetails({ symbol, setSymbol }: { symbol: string; setSymbol: (s: string) => void }) {
  const { quotes, lines, error, loading, refresh } = useQuotes([symbol], false);
  const q = quotes[symbol];
  const line = lines[symbol] ?? [];
  const color = changeColor(q?.changePct);
  const cur = stockCurrency(symbol);
  const closed = q ? Date.now() - q.tradeAt > 30 * 60_000 : false;
  const lo = Math.min(...line, q?.prevClose ?? Infinity);
  const hi = Math.max(...line, q?.prevClose ?? -Infinity);
  return (
    <CardFrame
      title={symbol}
      subtitle={q ? `${closed ? "Market closed · last trade " + relativeTime(q.tradeAt) : "Live"} · updated ${relativeTime(q.fetchedAt)}` : "Finnhub"}
      icon={CandlestickChart}
      actions={<IconButton icon={RefreshCw} label="Refresh" onClick={refresh} className={cx(loading && "animate-spin")} />}
      footer={
        <>
          <span className="flex-1 text-[11px] text-faint">Finnhub prices, refreshed once a minute.</span>
          <DisconnectButton />
        </>
      }
    >
      {q ? (
        <div className="flex items-baseline gap-2">
          <span className="text-[32px] leading-none font-semibold tabular-nums">{fmtPrice(q.price, { currency: cur })}</span>
          <span className="text-[13px] font-medium tabular-nums" style={{ color }}>
            {q.change > 0 ? "+" : ""}
            {fmtPrice(q.change)} ({fmtPct(q.changePct)})
          </span>
        </div>
      ) : (
        <Skeleton className="h-8 w-32" />
      )}
      <div className="mt-3 rounded-xl bg-input px-2 py-2">
        {line.length > 1 ? (
          <AreaChart data={line} height={110} color={color} min={lo} max={hi} grid={q ? [q.prevClose] : undefined} />
        ) : (
          <div className="grid h-[110px] place-items-center text-[12px] text-dim">The day's line builds up as new prices come in.</div>
        )}
      </div>
      {q && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Stat label="Open" value={fmtPrice(q.open)} />
          <Stat label="High" value={fmtPrice(q.high)} />
          <Stat label="Low" value={fmtPrice(q.low)} />
          <Stat label="Prev close" value={fmtPrice(q.prevClose)} />
        </div>
      )}
      {error && <ErrorState className="mt-3" message={q ? `${error} The price below is from the last update.` : error} onRetry={refresh} />}
      <Section title="Ticker" className="mt-3 mb-0">
        <TickerField symbols={[symbol]} max={1} onSave={(s) => setSymbol(s[0])} />
      </Section>
    </CardFrame>
  );
}

export default defineWidget<ChartConfig>({
  id: "stocks.chart",
  name: "Stock Chart",
  category: "Stocks",
  description: "A single stock's price, its change today and an intraday line.",
  keywords: ["stock", "ticker", "chart", "finnhub", "market", "shares", "price"],
  icon: CandlestickChart,
  size: "l",
  Tile: ChartTile,
  Card: ChartCard,
  Connect: ChartConnect,
  disconnect: forgetKey,
  cardSize: { width: 340 },
  defaultConfig: { symbol: "AAPL" },
});
