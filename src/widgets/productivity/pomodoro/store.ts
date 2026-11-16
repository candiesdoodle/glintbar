/**
 * Pomodoro: focus rounds and breaks. Persisted as timestamps ("productivity.pomodoro"). When a
 * phase ends it is recorded in the history and (optionally) the next one starts at that same
 * moment, so a restart replays what happened while GlintBar was closed.
 */
import { Coffee, Target } from "lucide-react";
import { notify } from "../../../automations/alerts";
import { cancelScheduled, scheduleAt } from "../../../automations/scheduler";
import { createPersistedStore } from "../../../core/store";
import { runsBackground } from "../shared/env";

export type Phase = "idle" | "focus" | "short" | "long";

export interface Session {
  kind: "focus" | "break";
  start: number;
  end: number;
  /** Ran to the end (not skipped or stopped). */
  done: boolean;
}

export interface PomodoroSettings {
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
  autoBreak: boolean;
  autoFocus: boolean;
}

export interface PomodoroState {
  phase: Phase;
  phaseStart: number | null;
  endsAt: number | null;
  pausedLeftMs: number | null;
  /** Focus rounds finished in the current cycle. */
  round: number;
  /** What comes next when idle. */
  next: Exclude<Phase, "idle">;
  history: Session[];
  settings: PomodoroSettings;
}

export const DEFAULT_POMODORO: PomodoroSettings = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoBreak: true, autoFocus: false };

export const usePomodoro = createPersistedStore<PomodoroState>(
  "productivity.pomodoro",
  { phase: "idle", phaseStart: null, endsAt: null, pausedLeftMs: null, round: 0, next: "focus", history: [], settings: DEFAULT_POMODORO },
  (saved) => ({ ...(saved as Partial<PomodoroState>), settings: { ...DEFAULT_POMODORO, ...((saved as Partial<PomodoroState>).settings ?? {}) } }),
);

const KEEP_MS = 60 * 86_400_000;

export function phaseMs(phase: Exclude<Phase, "idle">, s: PomodoroSettings): number {
  const min = phase === "focus" ? s.focusMin : phase === "short" ? s.shortMin : s.longMin;
  return Math.max(1, min) * 60_000;
}

export function leftMs(s: PomodoroState, now: number): number {
  if (s.endsAt) return Math.max(0, s.endsAt - now);
  if (s.pausedLeftMs !== null) return s.pausedLeftMs;
  return phaseMs(s.next, s.settings);
}

export function isPaused(s: PomodoroState): boolean {
  return s.phase !== "idle" && s.pausedLeftMs !== null;
}

function record(history: Session[], sess: Session): Session[] {
  if (sess.end - sess.start < 15_000) return history;
  const cutoff = sess.end - KEEP_MS;
  return [...history.filter((h) => h.end >= cutoff), sess].slice(-1000);
}

/** The phase after the current one ends, and the new round count. */
function after(s: PomodoroState): { next: Exclude<Phase, "idle">; round: number } {
  if (s.phase === "focus") {
    const round = s.round + 1;
    return { next: round % Math.max(1, s.settings.longEvery) === 0 ? "long" : "short", round };
  }
  return { next: "focus", round: s.phase === "long" ? 0 : s.round };
}

function begin(phase: Exclude<Phase, "idle">, at: number, s: PomodoroState): Partial<PomodoroState> {
  return { phase, phaseStart: at, endsAt: at + phaseMs(phase, s.settings), pausedLeftMs: null };
}

/** Applies every phase end up to `now`. Returns the new state and the last phase that ended. */
export function catchUp(s: PomodoroState, now: number): { state: PomodoroState; ended: Exclude<Phase, "idle"> | null; endedAt: number } {
  let state = s;
  let ended: Exclude<Phase, "idle"> | null = null;
  let endedAt = 0;
  for (let i = 0; i < 200 && state.phase !== "idle" && state.endsAt && state.endsAt <= now; i++) {
    const at = state.endsAt;
    const kind = state.phase === "focus" ? "focus" : "break";
    const history = record(state.history, { kind, start: state.phaseStart ?? at - phaseMs(state.phase, state.settings), end: at, done: true });
    const { next, round } = after(state);
    ended = state.phase;
    endedAt = at;
    const auto = kind === "focus" ? state.settings.autoBreak : state.settings.autoFocus;
    state = { ...state, history, round, next, ...(auto ? begin(next, at, state) : { phase: "idle", phaseStart: null, endsAt: null, pausedLeftMs: null }) };
  }
  return { state, ended, endedAt };
}

export const pomodoroActions = {
  /** Starts the next phase (focus by default), or pauses/resumes the running one. */
  toggle() {
    const s = usePomodoro.getState();
    if (s.phase === "idle") usePomodoro.setState(begin(s.next, Date.now(), s));
    else if (s.endsAt) usePomodoro.setState({ endsAt: null, pausedLeftMs: Math.max(0, s.endsAt - Date.now()) });
    else if (s.pausedLeftMs !== null) usePomodoro.setState({ endsAt: Date.now() + s.pausedLeftMs, pausedLeftMs: null });
  },
  start(phase: Exclude<Phase, "idle">) {
    const s = usePomodoro.getState();
    usePomodoro.setState(begin(phase, Date.now(), s));
  },
  /** Ends the current phase now and starts the next one. */
  skip() {
    const s = usePomodoro.getState();
    const now = Date.now();
    if (s.phase === "idle") {
      usePomodoro.setState(begin(s.next, now, s));
      return;
    }
    const kind = s.phase === "focus" ? "focus" : "break";
    const history = record(s.history, { kind, start: s.phaseStart ?? now, end: now, done: false });
    const { next, round } = after(s);
    usePomodoro.setState({ history, round, next, ...begin(next, now, { ...s, round }) });
  },
  stop() {
    const s = usePomodoro.getState();
    const now = Date.now();
    if (s.phase === "idle") {
      usePomodoro.setState({ round: 0, next: "focus" });
      return;
    }
    const kind = s.phase === "focus" ? "focus" : "break";
    const end = s.endsAt ? now : (s.phaseStart ?? now) + (phaseMs(s.phase, s.settings) - (s.pausedLeftMs ?? 0));
    usePomodoro.setState({ history: record(s.history, { kind, start: s.phaseStart ?? now, end: Math.min(end, now), done: false }), phase: "idle", phaseStart: null, endsAt: null, pausedLeftMs: null, next: "focus" });
  },
  setSettings(patch: Partial<PomodoroSettings>) {
    usePomodoro.setState((s) => ({ settings: { ...s.settings, ...patch } }));
  },
  clearHistory() {
    usePomodoro.setState({ history: [] });
  },
};

export const PHASE_LABEL: Record<Phase, string> = { idle: "Ready", focus: "Focus", short: "Break", long: "Long break" };

export function phaseColor(phase: Phase): string {
  return phase === "focus" ? "var(--g-bad)" : phase === "idle" ? "var(--g-accent)" : "var(--g-good)";
}

function announce(ended: Exclude<Phase, "idle">, state: PomodoroState, late: boolean) {
  const wasFocus = ended === "focus";
  const running = state.phase !== "idle";
  const mins = Math.round(phaseMs(state.next, state.settings) / 60_000);
  notify({
    kind: "pomodoro",
    key: "pomodoro",
    icon: wasFocus ? Coffee : Target,
    silent: late,
    title: wasFocus ? (running ? `Focus round over - your ${mins}-minute break is running` : "Focus round finished") : running ? "Break finished - next focus round started" : "Break finished",
    body: wasFocus ? `${state.round} round${state.round === 1 ? "" : "s"} this cycle` : undefined,
    actions: running
      ? [{ label: "Skip", run: () => pomodoroActions.skip() }]
      : [{ label: wasFocus ? "Start break" : "Start focus", primary: true, run: () => pomodoroActions.toggle() }],
  });
}

let started = false;
export function startPomodoroScheduler(): void {
  if (started || !runsBackground) return;
  started = true;
  const tick = () => {
    const now = Date.now();
    const s = usePomodoro.getState();
    const { state, ended, endedAt } = catchUp(s, now);
    if (ended) {
      usePomodoro.setState(state, true);
      announce(ended, state, now - endedAt > 120_000);
    }
  };
  let armed: number | null = null;
  const sync = (s: PomodoroState) => {
    if (s.endsAt === armed) return;
    armed = s.endsAt;
    if (s.endsAt) scheduleAt("pomodoro.end", s.endsAt, tick);
    else cancelScheduled("pomodoro.end");
  };
  usePomodoro.subscribe(sync);
  sync(usePomodoro.getState());
}

/** Focus sessions (done or not) that overlap the day starting at `dayStart`. */
export function focusOn(history: Session[], dayStart: number): Session[] {
  const end = dayStart + 86_400_000;
  return history.filter((h) => h.kind === "focus" && h.end > dayStart && h.start < end);
}

export function sampleHistory(now = Date.now()): Session[] {
  const out: Session[] = [];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  for (let d = 6; d >= 0; d--) {
    const base = day.getTime() - d * 86_400_000 + 9 * 3600_000;
    const rounds = d === 0 ? 3 : [4, 6, 2, 5, 7, 3, 4][d];
    for (let r = 0; r < rounds; r++) {
      const s = base + r * 32 * 60_000 + (r > 1 ? 60 * 60_000 : 0);
      if (s + 25 * 60_000 > now) break;
      out.push({ kind: "focus", start: s, end: s + 25 * 60_000, done: true });
    }
  }
  return out;
}
