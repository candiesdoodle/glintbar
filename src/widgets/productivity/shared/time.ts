/** Small time helpers shared by the productivity widgets. */

/** "in 12 min", "in 2 h 5 min", "now", "5 min ago". */
export function untilText(target: number, now: number): string {
  const diff = target - now;
  const a = Math.abs(diff);
  if (a < 60_000) return diff >= 0 ? "now" : "just now";
  const mins = Math.round(a / 60_000);
  let s: string;
  if (mins < 60) s = `${mins} min`;
  else if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    s = m ? `${h} h ${m} min` : `${h} h`;
  } else {
    const d = Math.round(mins / 1440);
    s = d === 1 ? "1 day" : `${d} days`;
  }
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

/** Compact countdown for tiles: "12m", "1h 05m", "45s". */
export function shortUntil(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.round(h / 24)}d`;
}

/** 1500 -> "25:00", 3725 -> "1:02:05" (seconds in, rounded up so 0.2 s left shows 00:01). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function startOfDay(t: number | Date): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** "HH:MM" for datetime-local inputs etc. */
export function toLocalInput(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Today at hh:mm, or tomorrow if that already passed. */
export function nextAt(hour: number, minute = 0, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
