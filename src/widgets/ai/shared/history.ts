/**
 * Readings over time, per limit window, for the usage-over-window chart in each card. A window's
 * points are dropped when it starts over (its reset time moves on, or the usage falls back).
 * Stored under "ai.history" (percentages and times only).
 */
import { getStored, setStored, useStored } from "../../../core/store";
import type { AiLimit } from "./types";

export type Point = [number, number];

export interface WindowHistory {
  resetsAt: number | null;
  windowMs: number;
  points: Point[];
}

export type HistoryMap = Record<string, WindowHistory>;

const KEY = "ai.history";
const MAX_POINTS = 240;

export function historyKey(l: Pick<AiLimit, "tool" | "window">): string {
  return `${l.tool}:${l.window}`;
}

/** Pure: the history after recording `limits` at `at`. */
export function nextHistory(prev: HistoryMap, limits: AiLimit[], at: number): HistoryMap {
  const out: HistoryMap = { ...prev };
  for (const l of limits) {
    if (!l.windowMs || !Number.isFinite(l.usedPct)) continue;
    const key = historyKey(l);
    let h = out[key];
    const last = h?.points[h.points.length - 1];
    const newWindow =
      !h ||
      (h.resetsAt !== null && l.resetsAt !== null && Math.abs(h.resetsAt - l.resetsAt) > 10 * 60_000) ||
      (h.resetsAt !== null && at > h.resetsAt) ||
      (last !== undefined && l.usedPct + 3 < last[1]);
    if (newWindow) h = { resetsAt: l.resetsAt, windowMs: l.windowMs, points: [] };
    else h = { ...h!, resetsAt: l.resetsAt ?? h!.resetsAt, points: [...h!.points] };
    const start = (h.resetsAt ?? at + l.windowMs) - l.windowMs;
    h.points = h.points.filter(([t]) => t >= start);
    const prevPoint = h.points[h.points.length - 1];
    if (prevPoint && at - prevPoint[0] < 60_000) h.points[h.points.length - 1] = [at, l.usedPct];
    else h.points.push([at, l.usedPct]);
    if (h.points.length > MAX_POINTS) h.points = h.points.slice(-MAX_POINTS);
    out[key] = h;
  }
  return out;
}

export function recordLimits(limits: AiLimit[], at = Date.now()): void {
  if (!limits.length) return;
  setStored(KEY, nextHistory(getStored<HistoryMap>(KEY, {}), limits, at));
}

export function useHistory(): HistoryMap {
  return useStored<HistoryMap>(KEY, {})[0];
}
