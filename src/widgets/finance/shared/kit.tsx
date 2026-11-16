/**
 * Shared tile and card pieces for the account widgets (finance, analytics, developer, online,
 * social). Theme colours only; everything scales from the tile height.
 */
import type { ReactNode } from "react";
import { AlertTriangle, CloudOff, type LucideIcon } from "lucide-react";
import { money, relativeTime } from "../../../core/format";
import { AreaChart, Button, ErrorState, Skeleton, TileFrame, TileSampleBadge as SharedSampleBadge, cx } from "../../../ui";
import { call } from "../../../core/backend";
import type { Polled } from "./poll";

/** A simple-icons glyph ({ path }), a monogram ({ text }) for brands without one, or a lucide icon. */
export type Glyph = { path: string; title?: string } | { text: string } | LucideIcon;

export const monogram = (text: string): Glyph => ({ text });

export function GlyphIcon({ glyph, size, className }: { glyph: Glyph; size: number; className?: string }) {
  if (typeof glyph === "object" && glyph !== null && "text" in glyph) {
    return (
      <span
        className={cx("grid shrink-0 place-items-center rounded-[28%] border-[1.5px] border-current font-bold leading-none", className)}
        style={{ width: size, height: size, fontSize: Math.round(size * (glyph.text.length > 1 ? 0.42 : 0.58)) }}
        aria-hidden
      >
        {glyph.text}
      </span>
    );
  }
  if (typeof glyph === "object" && glyph !== null && "path" in glyph) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cx("shrink-0", className)} fill="currentColor" aria-hidden>
        <path d={glyph.path} />
      </svg>
    );
  }
  const Icon = glyph as LucideIcon;
  return <Icon size={size} className={cx("shrink-0", className)} strokeWidth={2} />;
}

/** "+12%" in good/bad colour. `invert` when a rise is bad (bounces, errors). */
export function DeltaChip({ value, fontSize, invert, className }: { value: number | undefined; fontSize?: number; invert?: boolean; className?: string }) {
  if (value === undefined || !Number.isFinite(value)) return null;
  const up = value > 0.05;
  const down = value < -0.05;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const text = `${value > 0 ? "+" : ""}${Math.abs(value) >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}%`;
  return (
    <span className={cx("font-medium tabular-nums", good && "text-good", bad && "text-bad", !good && !bad && "text-dim", className)} style={{ fontSize }}>
      {text}
    </span>
  );
}

/** Percent change from `prev` to `cur`; undefined when there is nothing to compare. */
export function pctChange(cur: number, prev: number): number | undefined {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return undefined;
  if (prev === 0) return cur === 0 ? 0 : undefined;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export interface TileStatus {
  loading?: boolean;
  /** Error with no data to show. */
  error?: string;
  /** Showing older data because the last refresh failed. */
  staleMessage?: string;
}

export function statusOf<T>(p: Polled<T>, isSample: boolean): TileStatus {
  if (isSample) return {};
  return {
    loading: p.loading && p.data === undefined,
    error: p.data === undefined && p.error ? p.message : undefined,
    staleMessage: p.stale ? `${p.message} These numbers are from ${relativeTime(p.updatedAt ?? Date.now())}.` : undefined,
  };
}

/** The shared tile sample marker (src/ui), pinned to the tile's corner. */
export function TileSampleBadge({ size }: { size: number }) {
  return <SharedSampleBadge size={size} />;
}

/** Stale-data marker placed after the label (the sample marker sits in the corner). */
function Marker({ isSample, status, size }: { isSample: boolean; status: TileStatus; size: number }) {
  if (isSample) return null;
  if (status.staleMessage)
    return (
      <span className="shrink-0 text-warn" title={status.staleMessage}>
        <CloudOff size={Math.max(9, Math.round(size * 0.2))} />
      </span>
    );
  return null;
}

/** Label row: small glyph + label (truncates). */
function LabelRow({ glyph, label, size, marker }: { glyph?: Glyph; label: ReactNode; size: number; marker?: ReactNode }) {
  const fs = Math.max(9, Math.round(size * 0.22));
  return (
    <div className="flex min-w-0 items-center gap-[0.3em] text-dim" style={{ fontSize: fs, lineHeight: 1.1 }}>
      {glyph && <GlyphIcon glyph={glyph} size={Math.round(fs * 1.1)} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {marker}
    </div>
  );
}

export { Marker as TileMarker, LabelRow as TileLabelRow };

/** Small dim label line used at the top of tiles. */
export function TileLabel({ children, size, className }: { children: ReactNode; size: number; className?: string }) {
  return (
    <div className={cx("truncate text-dim", className)} style={{ fontSize: Math.max(9, Math.round(size * 0.22)), lineHeight: 1.1 }}>
      {children}
    </div>
  );
}

/** What fills the value slot while loading or failing. */
function ValueOrState({ status, size, children }: { status: TileStatus; size: number; children: ReactNode }) {
  if (status.loading) return <Skeleton className="mt-[3px] h-[0.9em] w-[3.2em]" />;
  if (status.error)
    return (
      <div className="mt-[2px] flex min-w-0 items-center gap-1 text-warn" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }} title={status.error}>
        <AlertTriangle size={Math.max(9, Math.round(size * 0.22))} className="shrink-0" />
        <span className="truncate">{shortError(status.error)}</span>
      </div>
    );
  return <>{children}</>;
}

/** A few words for a tile; the full message is in the tooltip and the card. */
export function shortError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("offline") || m.includes("can't be reached")) return "Offline";
  if (m.includes("rejected") || m.includes("sign in again") || m.includes("signed")) return "Sign in again";
  if (m.includes("not allowed") || m.includes("can't read") || m.includes("may only") || m.includes("may not")) return "Needs access";
  if (m.includes("not connected")) return "Not connected";
  if (m.includes("too many")) return "Busy, retrying";
  return "Can't load";
}

/**
 * The number tile: glyph, label, big value, optional sub-line (delta or text), optional
 * sparkline on wide tiles.
 */
export function MetricTile({
  glyph,
  label,
  value,
  sub,
  spark,
  size,
  isSample,
  status = {},
  title,
  sparkColor,
  bigGlyph,
}: {
  glyph?: Glyph;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  spark?: number[];
  size: number;
  isSample: boolean;
  status?: TileStatus;
  title?: string;
  sparkColor?: string;
  /** Glyph large on the left (default) or small in the label row. */
  bigGlyph?: boolean;
}) {
  const big = Math.round(size * 0.35);
  const hasSpark = Boolean(spark && spark.length > 1 && !status.error);
  const large = bigGlyph ?? true;
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.13)]" title={title ?? status.error}>
      {glyph && large && <GlyphIcon glyph={glyph} size={Math.round(size * 0.4)} className="text-dim" />}
      <div className="min-w-0 flex-1 leading-none">
        <LabelRow glyph={large ? undefined : glyph} label={label} size={size} marker={<Marker isSample={isSample} status={status} size={size} />} />
        <ValueOrState status={status} size={size}>
          <div className="mt-[3px] flex min-w-0 items-center gap-[0.35em] whitespace-nowrap">
            <span className="min-w-0 truncate font-semibold tabular-nums" style={{ fontSize: big }}>
              {value}
            </span>
            {sub !== undefined && (
              <span className="min-w-0 truncate text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
                {sub}
              </span>
            )}
          </div>
        </ValueOrState>
      </div>
      {isSample && <TileSampleBadge size={size} />}
      {hasSpark && (
        <div className="relative w-[38%] shrink-0 self-center">
          <AreaChart data={spark!} height={Math.round(size * 0.52)} min={0} color={sparkColor} strokeWidth={1.5} />
        </div>
      )}
    </TileFrame>
  );
}

/** The chart tile: label + this period's value + change on the left, the line on the right. */
export function ChartTile({
  glyph,
  label,
  value,
  change,
  invert,
  data,
  size,
  isSample,
  status = {},
  title,
  color,
}: {
  glyph?: Glyph;
  label: ReactNode;
  value: ReactNode;
  change?: number;
  invert?: boolean;
  data: number[];
  size: number;
  isSample: boolean;
  status?: TileStatus;
  title?: string;
  color?: string;
}) {
  const big = Math.round(size * 0.34);
  const small = Math.max(9, Math.round(size * 0.21));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.2)]" title={title ?? status.error}>
      <div className="flex min-w-0 shrink-0 flex-col justify-center leading-none" style={{ width: size < 40 ? "52%" : "46%" }}>
        <LabelRow glyph={glyph} label={label} size={size} />
        <ValueOrState status={status} size={size}>
          <div className="mt-[3px] flex min-w-0 items-baseline gap-[0.35em] whitespace-nowrap">
            <span className="truncate font-semibold tabular-nums" style={{ fontSize: big }}>
              {value}
            </span>
          </div>
          {change !== undefined && size >= 40 && (
            <div className="mt-[2px] truncate text-faint" style={{ fontSize: small }}>
              <DeltaChip value={change} invert={invert} fontSize={small} />
            </div>
          )}
        </ValueOrState>
      </div>
      <div
        className="relative flex min-w-0 flex-1 flex-col justify-end self-stretch"
        style={{ paddingTop: status.staleMessage ? 15 : Math.round(size * 0.16), paddingBottom: Math.round(size * 0.16) }}
      >
        {!status.error && data.length > 1 && <AreaChart data={data} min={0} height={Math.round(size * 0.66)} color={color} strokeWidth={1.6} className="min-h-0 flex-1" />}
        <span className="absolute top-[3px] right-0 flex">
          <Marker isSample={isSample} status={status} size={size} />
        </span>
      </div>
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

// ---- card pieces ---------------------------------------------------------------------------

/** The big number at the top of a card. */
export function CardHero({ label, value, change, sub, invert }: { label: ReactNode; value: ReactNode; change?: number; sub?: ReactNode; invert?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] text-dim">{label}</div>
        <div className="truncate text-[30px] leading-tight font-semibold tabular-nums">{value}</div>
      </div>
      <div className="shrink-0 pb-1 text-right text-[11px] text-faint">
        {change !== undefined && (
          <div>
            <DeltaChip value={change} invert={invert} fontSize={13} />
          </div>
        )}
        {sub}
      </div>
    </div>
  );
}

/** A labelled area chart for cards, with first/last date under it. */
export function CardChart({ data, labels, color, height = 96, format }: { data: number[]; labels?: string[]; color?: string; height?: number; format?: (v: number) => string }) {
  const max = data.length ? Math.max(...data) : 0;
  return (
    <div className="mt-3 rounded-xl bg-input px-2 pt-2 pb-1.5">
      <div className="relative">
        <AreaChart data={data} min={0} height={height} color={color} grid={max > 0 ? [max / 2] : undefined} />
        {format && max > 0 && <span className="absolute top-0 right-0 text-[10px] text-faint tabular-nums">{format(max)}</span>}
      </div>
      {labels && labels.length > 1 && (
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

export function StatGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return <div className={cx("mt-3 grid gap-x-3 gap-y-2.5", cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-4" : "grid-cols-3")}>{children}</div>;
}

/** Status line for cards: sample notice, error, or "Updated 5m ago". */
export function CardStatus<T>({ poll, isSample, sampleText }: { poll?: Polled<T>; isSample: boolean; sampleText?: string }) {
  if (isSample) return <p className="mt-3 text-[11.5px] text-faint">{sampleText ?? "These are sample figures. Connect an account to see your own."}</p>;
  if (!poll) return null;
  if (poll.error) return <ErrorState className="mt-3" message={poll.stale ? `${poll.message} The numbers below are the last ones that loaded.` : poll.message} onRetry={poll.refresh} />;
  if (poll.updatedAt) return <p className="mt-3 text-[11px] text-faint">Updated {relativeTime(poll.updatedAt)}</p>;
  return null;
}

/** "Open <site>" + "Disconnect" footer buttons. */
export function AccountFooter({ url, urlLabel, onDisconnect, extra }: { url?: string; urlLabel?: string; onDisconnect?: () => void; extra?: ReactNode }) {
  return (
    <>
      {url && (
        <Button size="sm" onClick={() => call("shell", "open", { target: url }).catch(() => {})}>
          {urlLabel ?? "Open dashboard"}
        </Button>
      )}
      {extra}
      <span className="flex-1" />
      {onDisconnect && (
        <Button size="sm" variant="ghost" onClick={onDisconnect}>
          Disconnect
        </Button>
      )}
    </>
  );
}

export function TestModeBadge() {
  return <span className="rounded-md bg-warn/20 px-1.5 py-0.5 text-[10px] font-semibold text-warn uppercase">Test mode</span>;
}

/** Money for tiles: "$1.5k", "$940", "$7.50" - narrow symbol, no stray cents. */
export function shortMoney(v: number, currency: string): string {
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 1000) return money(v, currency, { short: true });
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(v) < 10 && v !== 0 ? 2 : 0,
    }).format(v);
  } catch {
    return money(v, currency, { short: true });
  }
}

/** Full money with a narrow symbol: "$12,875", "$7.50". */
export function fullMoney(v: number, currency: string, cents?: boolean): string {
  if (!Number.isFinite(v)) return "–";
  const withCents = cents ?? Math.abs(v) < 1000;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: withCents ? 2 : 0,
      maximumFractionDigits: withCents ? 2 : 0,
    }).format(v);
  } catch {
    return money(v, currency, { cents: withCents });
  }
}

/** "16 Nov" style label for a YYYY-MM-DD key. */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
