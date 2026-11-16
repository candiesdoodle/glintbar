import { Flag, Pause, Play } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { elapsedMs, stopwatchActions, stopwatchText, useStopwatch } from "./store";

export function StopwatchTile({ size, isSample }: TileProps) {
  const real = useStopwatch();
  const running = isSample ? false : Boolean(real.startedAt);
  const now = useNow(running ? "second" : "minute").getTime();
  const ms = isSample ? 12 * 60_000 + 34_500 : elapsedMs(real, now);
  const laps = isSample ? 3 : real.laps.length;
  const btn = Math.round(size * 0.66);
  const big = Math.max(12, Math.round(size * 0.36));
  const small = Math.max(9, Math.round(size * 0.22));
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.14)]" title="Stopwatch">
      <button
        type="button"
        aria-label={running ? "Pause" : "Start"}
        className={"g-press grid shrink-0 place-items-center rounded-full " + (running ? "bg-warn/20 text-warn" : "bg-good/20 text-good")}
        style={{ width: btn, height: btn }}
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          if (!isSample) stopwatchActions.toggle();
        }}
      >
        {running ? <Pause size={Math.round(btn * 0.42)} fill="currentColor" /> : <Play size={Math.round(btn * 0.42)} fill="currentColor" className="translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1 leading-none">
        <div className="truncate text-dim" style={{ fontSize: small }}>
          {laps ? `Lap ${laps + 1}` : running ? "Running" : ms ? "Paused" : "Stopwatch"}
        </div>
        <div className="mt-[3px] font-semibold tabular-nums" style={{ fontSize: big }}>
          {stopwatchText(ms, false)}
        </div>
      </div>
      {running && size >= 38 && (
        <button
          type="button"
          aria-label="Lap"
          title="Lap"
          className="g-press -mr-1 grid shrink-0 place-items-center rounded-lg text-dim hover:bg-hover hover:text-fg"
          style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            stopwatchActions.lap();
          }}
        >
          <Flag size={Math.round(size * 0.28)} />
        </button>
      )}
    </TileFrame>
  );
}
