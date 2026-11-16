/**
 * Countdown timer. Persisted as timestamps ("productivity.timer"), never as a ticking counter,
 * so it keeps running with the card closed and across restarts; the end is scheduled once.
 */
import { Timer } from "lucide-react";
import { dismissKey, notify } from "../../../automations/alerts";
import { cancelScheduled, scheduleAt } from "../../../automations/scheduler";
import { createPersistedStore } from "../../../core/store";
import { runsBackground } from "../shared/env";
import { clock } from "../shared/time";

export interface TimerState {
  /** Running: when it ends (unix ms). */
  endsAt: number | null;
  /** Paused: what was left. */
  pausedLeftMs: number | null;
  /** Length of the current/last run, for the ring and "restart". */
  totalMs: number;
  /** Saved lengths in seconds. */
  presets: number[];
  finishedAt: number | null;
}

export const DEFAULT_PRESETS = [60, 5 * 60, 10 * 60, 25 * 60, 60 * 60];

export const useTimer = createPersistedStore<TimerState>("productivity.timer", {
  endsAt: null,
  pausedLeftMs: null,
  totalMs: 5 * 60_000,
  presets: DEFAULT_PRESETS,
  finishedAt: null,
});

export type TimerStatus = "idle" | "running" | "paused" | "finished";

export function timerStatus(s: TimerState): TimerStatus {
  if (s.endsAt) return "running";
  if (s.pausedLeftMs !== null) return "paused";
  if (s.finishedAt) return "finished";
  return "idle";
}

export function timerLeftMs(s: TimerState, now: number): number {
  if (s.endsAt) return Math.max(0, s.endsAt - now);
  if (s.pausedLeftMs !== null) return s.pausedLeftMs;
  if (s.finishedAt) return 0;
  return s.totalMs;
}

export const timerActions = {
  start(seconds: number) {
    const ms = Math.round(Math.max(1, Math.min(seconds, 100 * 3600)) * 1000);
    dismissKey("timer");
    useTimer.setState({ endsAt: Date.now() + ms, pausedLeftMs: null, totalMs: ms, finishedAt: null });
  },
  pause() {
    const s = useTimer.getState();
    if (!s.endsAt) return;
    useTimer.setState({ endsAt: null, pausedLeftMs: Math.max(0, s.endsAt - Date.now()) });
  },
  resume() {
    const s = useTimer.getState();
    if (s.pausedLeftMs === null) return;
    useTimer.setState({ endsAt: Date.now() + s.pausedLeftMs, pausedLeftMs: null });
  },
  /** Start/pause/resume in one button. */
  toggle() {
    const s = useTimer.getState();
    const st = timerStatus(s);
    if (st === "running") timerActions.pause();
    else if (st === "paused") timerActions.resume();
    else timerActions.start(s.totalMs / 1000);
  },
  reset() {
    dismissKey("timer");
    useTimer.setState({ endsAt: null, pausedLeftMs: null, finishedAt: null });
  },
  add(seconds: number) {
    const s = useTimer.getState();
    if (s.endsAt) useTimer.setState({ endsAt: s.endsAt + seconds * 1000, totalMs: s.totalMs + seconds * 1000 });
    else if (s.pausedLeftMs !== null) useTimer.setState({ pausedLeftMs: s.pausedLeftMs + seconds * 1000, totalMs: s.totalMs + seconds * 1000 });
  },
  savePreset(seconds: number) {
    const sec = Math.round(seconds);
    if (sec <= 0) return;
    useTimer.setState((s) => ({ presets: [...new Set([...s.presets, sec])].sort((a, b) => a - b).slice(0, 12) }));
  },
  removePreset(seconds: number) {
    useTimer.setState((s) => ({ presets: s.presets.filter((p) => p !== seconds) }));
  },
};

export function presetLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h && !m && !s) return `${h} h`;
  if (!h && m && !s) return `${m} min`;
  if (!h && !m) return `${s} s`;
  return clock(sec);
}

function finish(late: boolean) {
  const s = useTimer.getState();
  if (!s.endsAt) return;
  const total = s.totalMs;
  useTimer.setState({ endsAt: null, pausedLeftMs: null, finishedAt: s.endsAt });
  notify({
    kind: "timer",
    key: "timer",
    title: late ? "GlintBar was closed when your timer ran out" : "Time's up",
    body: `${presetLabel(Math.round(total / 1000))} timer`,
    icon: Timer,
    sticky: !late,
    silent: late,
    actions: [{ label: "Restart", primary: true, run: () => timerActions.start(total / 1000) }],
  });
}

let started = false;
export function startTimerScheduler(): void {
  if (started || !runsBackground) return;
  started = true;
  let armed: number | null = null;
  const sync = (s: TimerState) => {
    if (s.endsAt === armed) return;
    armed = s.endsAt;
    if (!s.endsAt) {
      cancelScheduled("timer.end");
      return;
    }
    const late = Date.now() - s.endsAt > 120_000;
    scheduleAt("timer.end", s.endsAt, () => finish(late));
  };
  useTimer.subscribe(sync);
  sync(useTimer.getState());
}

