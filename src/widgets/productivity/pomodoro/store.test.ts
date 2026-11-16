import { describe, expect, it } from "vitest";
import { catchUp, DEFAULT_POMODORO, type PomodoroState } from "./store";

const base = (patch: Partial<PomodoroState>): PomodoroState => ({ phase: "idle", phaseStart: null, endsAt: null, pausedLeftMs: null, round: 0, next: "focus", history: [], settings: DEFAULT_POMODORO, ...patch });

describe("pomodoro catch-up", () => {
  it("records a finished focus round and starts the break at its end", () => {
    const t0 = 1_000_000_000_000;
    const s = base({ phase: "focus", phaseStart: t0, endsAt: t0 + 25 * 60_000 });
    const { state, ended } = catchUp(s, t0 + 26 * 60_000);
    expect(ended).toBe("focus");
    expect(state.phase).toBe("short");
    expect(state.phaseStart).toBe(t0 + 25 * 60_000);
    expect(state.round).toBe(1);
    expect(state.history).toEqual([{ kind: "focus", start: t0, end: t0 + 25 * 60_000, done: true }]);
  });

  it("stops after the break when focus does not auto-start (app closed for hours)", () => {
    const t0 = 1_000_000_000_000;
    const s = base({ phase: "focus", phaseStart: t0, endsAt: t0 + 25 * 60_000, round: 3 });
    const { state, ended } = catchUp(s, t0 + 5 * 3600_000);
    expect(ended).toBe("long");
    expect(state.phase).toBe("idle");
    expect(state.next).toBe("focus");
    expect(state.round).toBe(0);
    expect(state.history.map((h) => h.kind)).toEqual(["focus", "break"]);
  });
});
