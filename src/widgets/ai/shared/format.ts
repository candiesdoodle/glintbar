import { duration, timeOfDay } from "../../../core/format";
import type { AiLimit } from "./types";

/** Accent while there is room, warning from 70 %, bad from 90 %. */
export function usageColor(pct: number | undefined | null): string {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return "var(--g-accent)";
  if (pct >= 90) return "var(--g-bad)";
  if (pct >= 70) return "var(--g-warn)";
  return "var(--g-accent)";
}

export const NEARLY_OUT_PCT = 85;

/** "2h 10m", "3d 4h", "a moment" - how long until `at`. */
export function resetIn(at: number | null | undefined, now: number): string {
  if (!at) return "–";
  const s = (at - now) / 1000;
  if (s <= 60) return "a moment";
  return duration(s);
}

/** Compact for tiles: "2h", "45m", "3d". */
export function resetShort(at: number | null | undefined, now: number): string {
  if (!at) return "";
  const s = Math.max(0, (at - now) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** "today 16:40", "tomorrow 09:00", "Thu 09:00", "20 Nov". */
export function resetAt(at: number | null | undefined, now: number, hour24 = true): string {
  if (!at) return "";
  const d = new Date(at);
  const n = new Date(now);
  const t = timeOfDay(d, { hour24 });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(n)) / 86_400_000);
  if (days === 0) return `today ${t}`;
  if (days === 1) return `tomorrow ${t}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${t}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The window's reset phrase for a card: "Resets in 2h 10m · today 16:40". */
export function resetLine(l: AiLimit, now: number, hour24 = true): string {
  if (!l.resetsAt) return l.usedPct > 0 ? "No reset time given" : "Begins when you next use it";
  return `Resets in ${resetIn(l.resetsAt, now)} · ${resetAt(l.resetsAt, now, hour24)}`;
}

export function pct(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  if (v > 0 && v < 1) return "<1%";
  return `${Math.round(v)}%`;
}

/** "claude-opus-4-5-20251101" -> "Opus 4.5"; other ids lose their provider prefix. */
export function modelName(id: string | null | undefined): string {
  if (!id) return "–";
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  const m = /^claude-(?:(\d+)-(\d+)-)?(opus|sonnet|haiku)(?:-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?)?/i.exec(bare);
  if (m) {
    const family = m[3][0].toUpperCase() + m[3].slice(1).toLowerCase();
    const major = m[4] ?? m[1];
    const minor = m[4] ? m[5] : m[2];
    if (!major) return family;
    return `${family} ${major}${minor ? `.${minor}` : ""}`;
  }
  return bare;
}

/** Local midnight of `now`. */
export function startOfDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Sum of series values with start >= since (and < until). */
export function sumSince(series: Array<[number, number]>, since: number, until = Infinity): number {
  let s = 0;
  for (const [t, v] of series) if (t >= since && t < until) s += v;
  return s;
}

/** Money with the narrow symbol ("$18.42", not "US$18.42"). */
export function cash(amount: number, currency = "USD", digits = 2): string {
  if (!Number.isFinite(amount)) return "–";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}
