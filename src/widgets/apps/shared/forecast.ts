/**
 * "Full in N days" for a drive: one free-space sample per day is kept in the store
 * ("apps.storageHistory"), and a straight line through the last month says when it reaches 0.
 */
import { getStored, setStored } from "../../../core/store";

export type History = Record<string, Array<[day: number, free: number]>>;

export const HISTORY_KEY = "apps.storageHistory";
const KEEP_DAYS = 60;

export function dayNumber(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/** Adds today's sample (replacing an earlier one from today). Pure. */
export function addSample(history: History, root: string, free: number, nowMs: number): History {
  const day = dayNumber(nowMs);
  const list = (history[root] ?? []).filter(([d]) => d !== day && d > day - KEEP_DAYS);
  list.push([day, free]);
  list.sort((a, b) => a[0] - b[0]);
  return { ...history, [root]: list };
}

/** Days until the drive is full at the recent pace, or null when it isn't filling up. */
export function daysUntilFull(samples: Array<[number, number]>, free: number): number | null {
  const recent = samples.slice(-30);
  if (recent.length < 3) return null;
  const span = recent[recent.length - 1][0] - recent[0][0];
  if (span < 3) return null;
  const n = recent.length;
  const mx = recent.reduce((s, [d]) => s + d, 0) / n;
  const my = recent.reduce((s, [, f]) => s + f, 0) / n;
  let num = 0;
  let den = 0;
  for (const [d, f] of recent) {
    num += (d - mx) * (f - my);
    den += (d - mx) * (d - mx);
  }
  if (den === 0) return null;
  const slope = num / den; // bytes per day
  if (slope >= -1e6) return null; // losing under ~1 MB a day: not filling up
  const days = Math.round(free / -slope);
  return days > 0 && days <= 999 ? days : null;
}

/** Records today's free space for each drive (once a day) and returns the history. */
export function recordDrives(drives: Array<{ root: string; free: number }>, nowMs = Date.now()): History {
  let history = getStored<History>(HISTORY_KEY, {});
  const day = dayNumber(nowMs);
  let changed = false;
  for (const d of drives) {
    const list = history[d.root] ?? [];
    const last = list[list.length - 1];
    if (!last || last[0] !== day || Math.abs(last[1] - d.free) > 256 * 1024 * 1024) {
      history = addSample(history, d.root, d.free, nowMs);
      changed = true;
    }
  }
  if (changed) setStored(HISTORY_KEY, history);
  return history;
}
