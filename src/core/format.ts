/** Display formatting shared by every widget. Pure functions; locale-aware where it matters. */

/** 950 -> "950", 1530 -> "1.5k", 12323 -> "12k", 1_250_000 -> "1.3M". */
export function shortNumber(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (Math.round(a) < 1000) {
    return sign + (Number.isInteger(a) || a >= 100 ? String(Math.round(a)) : trimZeros(a.toFixed(digits)));
  }
  const units: Array<[number, string]> = [
    [1e3, "k"],
    [1e6, "M"],
    [1e9, "B"],
    [1e12, "T"],
  ];
  for (const [size, suffix] of units) {
    const v = a / size;
    const shown = v >= 10 ? String(Math.round(v)) : trimZeros(v.toFixed(digits));
    // 999.95k would read "1000k": move up to the next unit instead.
    if (Number(shown) < 1000 || suffix === "T") return `${sign}${shown}${suffix}`;
  }
  return sign + String(a);
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Money in a currency. `short` gives "$1.5k". */
export function money(amount: number, currency = "USD", opts: { short?: boolean; cents?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "–";
  if (opts.short && Math.abs(amount) >= 1000) {
    const symbol = currencySymbol(currency);
    return `${amount < 0 ? "-" : ""}${symbol}${shortNumber(Math.abs(amount))}`;
  }
  const cents = opts.cents ?? Math.abs(amount) < 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** 0.423 -> "42%" when `fraction`, else 42.3 -> "42%". */
export function percent(value: number, opts: { fraction?: boolean; digits?: number } = {}): string {
  if (!Number.isFinite(value)) return "–";
  const v = opts.fraction ? value * 100 : value;
  return `${v.toFixed(opts.digits ?? 0)}%`;
}

/** Signed change: +12%, -3.4%. */
export function delta(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "–";
  const s = value.toFixed(digits);
  return value > 0 ? `+${s}%` : `${s}%`;
}

/**
 * Seconds -> "45s", "5m", "1h 5m", "2d 3h". `style: "clock"` -> "05:09" / "1:05:09".
 */
export function duration(seconds: number, style: "short" | "clock" = "short"): string {
  if (!Number.isFinite(seconds)) return "–";
  const neg = seconds < 0;
  let s = Math.floor(Math.abs(seconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const sign = neg ? "-" : "";
  if (style === "clock") {
    const hh = d * 24 + h;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return sign + (hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`);
  }
  if (d > 0) return `${sign}${d}d${h ? ` ${h}h` : ""}`;
  if (h > 0) return `${sign}${h}h${m ? ` ${m}m` : ""}`;
  if (m > 0) return `${sign}${m}m`;
  return `${sign}${s}s`;
}

/** "just now", "5m ago", "in 3h", "yesterday", "2d ago", or a date beyond a week. */
export function relativeTime(when: Date | number, now: Date | number = Date.now()): string {
  const t = typeof when === "number" ? when : when.getTime();
  const n = typeof now === "number" ? now : now.getTime();
  const diff = (t - n) / 1000;
  const a = Math.abs(diff);
  const future = diff > 0;
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (a < 45) return future ? "in a moment" : "just now";
  if (a < 3600) return wrap(`${Math.round(a / 60)}m`);
  if (a < 86400) return wrap(`${Math.round(a / 3600)}h`);
  const days = Math.round(a / 86400);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 7) return wrap(`${days}d`);
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "14:05" or "2:05 PM"; with seconds "14:05:09". */
export function timeOfDay(d: Date, opts: { hour24?: boolean; seconds?: boolean } = {}): string {
  const hour24 = opts.hour24 ?? true;
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  let suffix = "";
  if (!hour24) {
    suffix = h >= 12 ? " PM" : " AM";
    h = h % 12 || 12;
  }
  const hh = hour24 ? String(h).padStart(2, "0") : String(h);
  return `${hh}:${m}${opts.seconds ? `:${s}` : ""}${suffix}`;
}

/** Splits the time for big-digit layouts: { main: "2:05", seconds: "09", period: "PM" }. */
export function timeParts(d: Date, hour24: boolean): { main: string; seconds: string; period: string } {
  const t = timeOfDay(d, { hour24 });
  const [main, period = ""] = t.split(" ");
  return { main, seconds: String(d.getSeconds()).padStart(2, "0"), period };
}

/** "Mon 16 Nov" (locale order). */
export function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "Monday, 16 November 2026" (locale order). */
export function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** 1536 -> "1.5 KB" (base 1024). */
export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${n < 0 ? "-" : ""}${i === 0 ? v : trimZeros(v.toFixed(digits))} ${units[i]}`;
}

/** ISO-8601 week number. */
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
