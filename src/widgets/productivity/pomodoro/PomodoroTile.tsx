import { Pause, Play, SkipForward } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { Ring, TileFrame } from "../../../ui";
import { clock } from "../shared/time";
import { isPaused, leftMs, PHASE_LABEL, phaseColor, phaseMs, pomodoroActions, usePomodoro } from "./store";

export function PomodoroTile({ size, isSample }: TileProps) {
  const real = usePomodoro();
  const s = isSample ? { ...real, phase: "focus" as const, endsAt: null, pausedLeftMs: 14 * 60_000 + 12_000, round: 1 } : real;
  const running = !isSample && Boolean(s.endsAt);
  const now = useNow(running ? "second" : "minute").getTime();
  const left = leftMs(s, now);
  const total = s.phase === "idle" ? phaseMs(s.next, s.settings) : phaseMs(s.phase, s.settings);
  const ring = Math.round(size * 0.7);
  const big = Math.max(12, Math.round(size * 0.36));
  const small = Math.max(9, Math.round(size * 0.22));
  const paused = isPaused(s) && !isSample;
  const label = s.phase === "idle" ? (s.next === "focus" ? "Focus" : PHASE_LABEL[s.next]) : `${PHASE_LABEL[s.phase]}${paused ? " · paused" : s.phase === "focus" ? ` · ${(s.round % s.settings.longEvery) + 1}/${s.settings.longEvery}` : ""}`;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title="Pomodoro">
      <button
        type="button"
        aria-label={running ? "Pause" : "Start"}
        className="g-press shrink-0 rounded-full"
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          if (!isSample) pomodoroActions.toggle();
        }}
      >
        <Ring value={s.phase === "idle" ? 0 : total - left} max={total} size={ring} color={phaseColor(s.phase)}>
          {running ? <Pause size={Math.round(ring * 0.38)} fill="currentColor" /> : <Play size={Math.round(ring * 0.38)} fill="currentColor" className="translate-x-[1px]" />}
        </Ring>
      </button>
      <div className="min-w-0 flex-1 leading-none">
        <div className="truncate text-dim" style={{ fontSize: small }}>
          {label}
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: big }}>
          {clock(left / 1000)}
        </div>
      </div>
      {s.phase !== "idle" && size >= 38 && (
        <button
          type="button"
          aria-label="Skip"
          title={s.phase === "focus" ? "Skip to the break" : "Skip the break"}
          className="g-press -mr-1 grid shrink-0 place-items-center rounded-lg text-dim hover:bg-hover hover:text-fg"
          style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            if (!isSample) pomodoroActions.skip();
          }}
        >
          <SkipForward size={Math.round(size * 0.28)} />
        </button>
      )}
    </TileFrame>
  );
}
