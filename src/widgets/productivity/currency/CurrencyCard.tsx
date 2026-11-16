import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, Coins, RefreshCw, Search, Star, X } from "lucide-react";
import { relativeTime } from "../../../core/format";
import { describeError } from "../../../core/http";
import type { CardProps } from "../../../core/widget";
import { CardFrame, cx, ErrorState, IconButton, SampleBadge, Spinner } from "../../../ui";
import { currencyName, searchCurrencies } from "./currencies";
import { CurrencyChip } from "./CurrencyChip";
import { convert, formatAmount, parseAmount, SAMPLE_RATES, useRates } from "./rates";
import type { CurrencyConfig } from "./types";

export function CurrencyCard({ config, setConfig, isSample }: CardProps<CurrencyConfig>) {
  const { rates, refresh } = useRates(!isSample);
  const table = !isSample && rates ? rates.rates : SAMPLE_RATES;
  const [text, setText] = useState(() => String(config.amount));
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmount(text);
  const result = amount === null ? null : convert(amount, config.from, config.to, table);
  const rate = convert(1, config.from, config.to, table);

  useEffect(() => {
    if (amount !== null && amount !== config.amount) setConfig({ amount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  const pick = (code: string) => {
    if (picking === "from") setConfig(code === config.to ? { from: code, to: config.from } : { from: code });
    if (picking === "to") setConfig(code === config.from ? { to: code, from: config.to } : { to: code });
    setPicking(null);
  };

  if (picking) return <Picker title={picking === "from" ? "Convert from" : "Convert to"} current={picking === "from" ? config.from : config.to} favorites={config.favorites} onPick={pick} onClose={() => setPicking(null)} />;

  const others = config.favorites.filter((c) => c !== config.from && c !== config.to);
  return (
    <CardFrame
      title="Currency"
      icon={Coins}
      subtitle={!isSample && rates ? `Rates from ${relativeTime(rates.updatedAt)} · ${rates.provider}` : "Showing sample rates until real ones load"}
      actions={
        <>
          {(isSample || !rates) && <SampleBadge />}
          {busy ? (
            <Spinner />
          ) : (
            <IconButton
              icon={RefreshCw}
              label="Refresh rates"
              onClick={() => {
                if (isSample) return;
                setBusy(true);
                setError(null);
                refresh()
                  .catch((e) => setError(describeError(e)))
                  .finally(() => setBusy(false));
              }}
            />
          )}
        </>
      }
    >
      <div className="rounded-xl bg-input p-3">
        <div className="flex items-center gap-2">
          <CurrencyButton code={config.from} onClick={() => setPicking("from")} />
          <input
            inputMode="decimal"
            aria-label="Amount"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.target.select()}
            className={cx("h-11 min-w-0 flex-1 rounded-lg bg-transparent text-right text-[24px] font-semibold tabular-nums outline-none", amount === null && text.trim() ? "text-bad" : "text-fg")}
          />
        </div>
        <div className="my-1 flex items-center gap-2">
          <div className="h-px flex-1 bg-card-line" />
          <IconButton icon={ArrowDownUp} label="Swap" onClick={() => setConfig({ from: config.to, to: config.from })} />
          <div className="h-px flex-1 bg-card-line" />
        </div>
        <div className="flex items-center gap-2">
          <CurrencyButton code={config.to} onClick={() => setPicking("to")} />
          <div className="min-w-0 flex-1 truncate text-right text-[24px] font-semibold tabular-nums">{result === null ? "–" : formatAmount(result, config.to)}</div>
        </div>
      </div>
      <div className="mt-1.5 px-1 text-[11.5px] text-dim tabular-nums">
        {rate === null ? "This pair has no rate yet." : `1 ${config.from} = ${formatAmount(rate, config.to)} ${config.to} · 1 ${config.to} = ${formatAmount(1 / rate, config.from)} ${config.from}`}
      </div>
      {error && <ErrorState className="mt-2" message={error} />}
      {others.length > 0 && amount !== null && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Also</div>
          {others.map((c) => {
            const v = convert(amount, config.from, c, table);
            return (
              <button key={c} type="button" onClick={() => setConfig({ to: c })} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-hover">
                <CurrencyChip code={c} size={20} />
                <span className="w-10 text-[12.5px] font-medium">{c}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-dim">{currencyName(c)}</span>
                <span className="text-[13px] tabular-nums">{v === null ? "–" : formatAmount(v, c)}</span>
              </button>
            );
          })}
        </div>
      )}
    </CardFrame>
  );
}

function CurrencyButton({ code, onClick }: { code: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={currencyName(code)} className="g-press flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-card px-2 hover:bg-hover">
      <CurrencyChip code={code} size={22} />
      <span className="text-[14px] font-semibold">{code}</span>
      <ChevronDown size={14} className="text-dim" />
    </button>
  );
}

function Picker({ title, current, favorites, onPick, onClose }: { title: string; current: string; favorites: string[]; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = useMemo(() => searchCurrencies(q, 160), [q]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return (
    <CardFrame title={title} icon={Coins} actions={<IconButton icon={X} label="Back" onClick={onClose} />}>
      <div className="relative mb-2">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a code, country or name - near spellings match"
          className="h-9 w-full rounded-lg border border-card-line bg-input pr-2.5 pl-8 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && results[sel]) onPick(results[sel].code);
          }}
        />
      </div>
      {results.length === 0 && <div className="px-1 py-4 text-center text-[12px] text-dim">Nothing found for "{q}".</div>}
      <div ref={listRef} className="g-scroll-y max-h-[320px] overflow-y-auto">
        {results.map((c, i) => (
          <button
            key={c.code}
            type="button"
            data-i={i}
            onClick={() => onPick(c.code)}
            onMouseEnter={() => setSel(i)}
            className={cx("flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left", i === sel ? "bg-hover" : "")}
          >
            <CurrencyChip code={c.code} size={20} />
            <span className={cx("w-10 text-[12.5px] font-semibold", c.code === current && "text-accent")}>{c.code}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{currencyName(c.code)}</span>
            {favorites.includes(c.code) && <Star size={12} className="text-warn" fill="currentColor" />}
          </button>
        ))}
      </div>
    </CardFrame>
  );
}
