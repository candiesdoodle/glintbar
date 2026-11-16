/** Deterministic, believable sample numbers for tiles that are not connected yet. */

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date | number): string {
  const x = typeof d === "number" ? new Date(d) : d;
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

/** The last `n` local days, oldest first, ending today. */
export function lastDays(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    out.push(dayKey(d));
  }
  return out;
}

/** Local midnight `daysAgo` days before today. */
export function startOfDay(daysAgo = 0, now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function rng(seed: string | number): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` daily values around `base` with weekly rhythm, noise and a gentle upward trend.
 * Same seed, same numbers (so tiles don't jump between renders).
 */
export function sampleSeries(seed: string, n: number, base: number, opts: { noise?: number; trend?: number; integer?: boolean; weekly?: number } = {}): number[] {
  const r = rng(seed);
  const noise = opts.noise ?? 0.35;
  const trend = opts.trend ?? 0.25;
  const weekly = opts.weekly ?? 0.18;
  const out: number[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i));
    const dow = d.getDay();
    const week = dow === 0 || dow === 6 ? 1 - weekly : 1 + weekly * 0.4;
    const growth = 1 - trend / 2 + (trend * i) / Math.max(1, n - 1);
    let v = base * week * growth * (1 + (r() - 0.5) * 2 * noise);
    // Today is only partly over.
    if (i === n - 1) v *= 0.35 + 0.4 * r();
    v = Math.max(0, v);
    out.push(opts.integer ? Math.round(v) : Math.round(v * 100) / 100);
  }
  return out;
}
