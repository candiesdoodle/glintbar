import { List, RefreshCw } from "lucide-react";
import { relativeTime } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, cx, ErrorState, IconButton, Section, Sparkline, TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { normalizeSymbol, forgetKey } from "../finnhub";
import { changeColor, fmtPct, fmtPrice, stockCurrency, useQuotes } from "../shared";
import { DisconnectButton, StocksConnect, TickerField } from "../StocksConnect";

type WatchConfig = { symbols: string[] };
const DEFAULTS = ["AAPL", "MSFT", "NVDA"];

function symbolsOf(config: WatchConfig): string[] {
  const list = (Array.isArray(config.symbols) ? config.symbols : DEFAULTS).map(normalizeSymbol).filter(Boolean);
  return list.length ? list.slice(0, 5) : DEFAULTS;
}

function WatchTile({ config, size, isSample }: TileProps<WatchConfig>) {
  const all = symbolsOf(config);
  const shown = all.slice(0, 3);
  // Only the tickers on the tile are fetched; the card fetches the rest.
  const { quotes } = useQuotes(shown, isSample);
  const small = Math.max(9, Math.round(size * 0.2));
  return (
    <TileFrame className="justify-between gap-[calc(var(--tile-h)*0.1)] px-[calc(var(--tile-h)*0.18)]">
      {shown.map((s, i) => {
        const q = quotes[s];
        return (
          <div key={s} className={cx("flex min-w-0 flex-1 flex-col leading-none", i > 0 && "border-l border-line pl-[calc(var(--tile-h)*0.14)]")} title={q ? `${s} ${fmtPrice(q.price)} (${fmtPct(q.changePct)})` : s}>
            <span className="truncate font-semibold text-dim" style={{ fontSize: small }}>
              {s}
            </span>
            <span className="mt-[3px] truncate font-semibold tabular-nums" style={{ fontSize: Math.max(10, Math.round(size * 0.26)) }}>
              {q ? fmtPrice(q.price) : "–"}
            </span>
            <span className="mt-[2px] font-medium tabular-nums" style={{ fontSize: small, color: changeColor(q?.changePct) }}>
              {fmtPct(q?.changePct)}
            </span>
          </div>
        );
      })}
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function WatchConnect({ config, setConfig }: CardProps<WatchConfig>) {
  return <StocksConnect symbols={symbolsOf(config)} max={5} onSymbols={(symbols) => setConfig({ symbols })} />;
}

function WatchCard(props: CardProps<WatchConfig>) {
  const { config, setConfig, isSample } = props;
  const symbols = symbolsOf(config);
  const { quotes, lines, error, loading, refresh } = useQuotes(symbols, isSample);
  if (isSample) return <WatchConnect {...props} />;
  const updated = Math.max(0, ...symbols.map((s) => quotes[s]?.fetchedAt ?? 0));
  return (
    <CardFrame
      title="Watchlist"
      subtitle={updated ? `Updated ${relativeTime(updated)}` : "Finnhub"}
      icon={List}
      actions={<IconButton icon={RefreshCw} label="Refresh" onClick={refresh} className={cx(loading && "animate-spin")} />}
      footer={
        <>
          <span className="flex-1 text-[11px] text-faint">Only the first three fit on the tile.</span>
          <DisconnectButton />
        </>
      }
    >
      <Section>
        {symbols.map((s, i) => {
          const q = quotes[s];
          const line = lines[s] ?? [];
          const color = changeColor(q?.changePct);
          return (
            <div key={s} className={cx("flex items-center gap-3 py-2.5", i > 0 && "border-t border-card-line")}>
              <div className="w-[64px] shrink-0">
                <div className="text-[13px] font-semibold">{s}</div>
                <div className="text-[11px] text-faint tabular-nums">{q ? `H ${fmtPrice(q.high)}` : "–"}</div>
              </div>
              <div className="min-w-0 flex-1">{line.length > 1 ? <Sparkline data={line} height={26} color={color} /> : <div className="h-px bg-track" />}</div>
              <div className="w-[86px] shrink-0 text-right tabular-nums">
                <div className="text-[13px] font-semibold">{q ? fmtPrice(q.price, { currency: stockCurrency(s) }) : "–"}</div>
                <div className="text-[11.5px] font-medium" style={{ color }}>
                  {fmtPct(q?.changePct)}
                </div>
              </div>
            </div>
          );
        })}
      </Section>
      {error && <ErrorState className="mb-3" message={`${error} Prices below are from the last update.`} onRetry={refresh} />}
      <Section title="Tickers (up to 5)" className="mb-0">
        <TickerField symbols={symbols} max={5} onSave={(next) => setConfig({ symbols: next })} />
      </Section>
    </CardFrame>
  );
}

export default defineWidget<WatchConfig>({
  id: "stocks.watchlist",
  name: "Stock Watchlist",
  category: "Stocks",
  description: "Up to three stocks side by side, with price and today's change.",
  keywords: ["stocks", "watchlist", "tickers", "finnhub", "market", "portfolio"],
  icon: List,
  size: "xl",
  Tile: WatchTile,
  Card: WatchCard,
  Connect: WatchConnect,
  disconnect: forgetKey,
  cardSize: { width: 340 },
  defaultConfig: { symbols: DEFAULTS },
});
