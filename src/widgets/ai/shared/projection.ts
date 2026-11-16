import type { AiLimit } from "./types";
import type { Point } from "./history";

export interface Projection {
  /** Where the window is headed by its reset at the average pace so far (may exceed 100). */
  projected: number;
  /** When it would run out at that pace, if before the reset. */
  runsOutAt: number | null;
}

/** Average-pace projection to the reset. Null while too little of the window has passed. */
export function project(l: AiLimit, now: number): Projection | null {
  if (!l.resetsAt || !l.windowMs || l.resetsAt <= now) return null;
  const start = l.resetsAt - l.windowMs;
  const elapsed = now - start;
  if (elapsed < Math.min(10 * 60_000, l.windowMs * 0.02)) return null;
  const rate = l.usedPct / elapsed;
  const projected = l.usedPct + rate * (l.resetsAt - now);
  const runsOutAt = projected > 100 && rate > 0 && l.usedPct < 100 ? now + (100 - l.usedPct) / rate : null;
  return { projected, runsOutAt };
}

/**
 * Turns a token series into the shape of a limit's use through its window: cumulative tokens since
 * the window started, scaled so the last point equals the current percentage.
 */
export function pointsFromSeries(series: Array<[number, number]>, start: number, now: number, usedPct: number, step: number): Point[] {
  const inWindow = series.filter(([t]) => t >= start && t <= now);
  const total = inWindow.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return [];
  let acc = 0;
  return inWindow.map(([t, v]) => {
    acc += v;
    return [Math.min(now, t + step), (acc / total) * usedPct] as Point;
  });
}
