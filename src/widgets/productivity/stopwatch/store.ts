/** Stopwatch, persisted as timestamps ("productivity.stopwatch"): survives the card closing and restarts. */
import { createPersistedStore } from "../../../core/store";

export interface StopwatchState {
  /** Running since (unix ms), or null when paused/reset. */
  startedAt: number | null;
  /** Time banked before the current run. */
  accMs: number;
  /** Elapsed time at each lap, oldest first. */
  laps: number[];
}

export const useStopwatch = createPersistedStore<StopwatchState>("productivity.stopwatch", { startedAt: null, accMs: 0, laps: [] });

export function elapsedMs(s: StopwatchState, now: number): number {
  return s.accMs + (s.startedAt ? Math.max(0, now - s.startedAt) : 0);
}

export const stopwatchActions = {
  toggle() {
    const s = useStopwatch.getState();
    if (s.startedAt) useStopwatch.setState({ startedAt: null, accMs: elapsedMs(s, Date.now()) });
    else useStopwatch.setState({ startedAt: Date.now() });
  },
  lap() {
    const s = useStopwatch.getState();
    const e = elapsedMs(s, Date.now());
    if (e <= 0) return;
    useStopwatch.setState({ laps: [...s.laps, e].slice(-500) });
  },
  reset() {
    useStopwatch.setState({ startedAt: null, accMs: 0, laps: [] });
  },
};

/** 83456 -> "01:23.4"; with hours "1:01:23.4". `tenths: false` drops the decimal. */
export function stopwatchText(ms: number, tenths = true): string {
  const t = Math.max(0, Math.floor(ms / 100));
  const d = t % 10;
  const s = Math.floor(t / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const core = `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return tenths ? `${core}.${d}` : core;
}

/** Each lap's own length. */
export function lapSplits(laps: number[]): number[] {
  return laps.map((l, i) => l - (i ? laps[i - 1] : 0));
}
