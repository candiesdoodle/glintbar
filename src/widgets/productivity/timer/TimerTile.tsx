import { Pause, Play, RotateCcw } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { Ring, TileFrame } from "../../../ui";
import { clock } from "../shared/time";
import { presetLabel, timerActions, timerLeftMs, timerStatus, useTimer } from "./store";

export function TimerTile({ size, isSample }: TileProps) {
  const real = useTimer();
  const st = isSample ? "running" : timerStatus(real);
  // Ticks once a second only while running and visible.
  const now = useNow(st === "running" && !isSample ? "second" : "minute").getTime();
  const left = isSample ? 7 * 60_000 + 42_000 : timerLeftMs(real, now);
  const total = isSample ? 10 * 60_000 : real.totalMs;
  const ring = Math.round(size * 0.62);
  const big = Math.max(11, Math.round(size * 0.32));
  const small = Math.max(9, Math.round(size * 0.22));
  const Icon = st === "running" ? Pause : st === "finished" ? RotateCcw : Play;
  const label = st === "running" ? "Timer" : st === "paused" ? "Paused" : st === "finished" ? "Done" : presetLabel(Math.round(total / 1000));

  return (
    <TileFrame padded={false} className="gap-[calc(var(--tile-h)*0.12)] px-[calc(var(--tile-h)*0.14)]" title="Timer">
      <button
        type="button"
        aria-label={st === "running" ? "Pause" : "Start"}
        className="g-press shrink-0 rounded-full"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!isSample) timerActions.toggle();
        }}
      >
        <Ring value={st === "idle" ? 0 : total - left} max={total} size={ring} color={st === "finished" ? "var(--g-good)" : st === "paused" ? "var(--g-warn)" : "var(--g-accent)"}>
          <Icon size={Math.round(ring * 0.4)} className="text-fg" fill={st === "finished" ? "none" : "currentColor"} />
        </Ring>
      </button>
      <div className="min-w-0 leading-none">
        <div className="truncate text-dim" style={{ fontSize: small }}>
          {label}
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: big }}>
          {clock(left / 1000)}
        </div>
      </div>
    </TileFrame>
  );
}
