import { useState } from "react";
import { Flag, Pause, Play, RotateCcw, Watch } from "lucide-react";
import { useInterval } from "../../../core/useVisible";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, EmptyState } from "../../../ui";
import { elapsedMs, lapSplits, stopwatchActions, stopwatchText, useStopwatch } from "./store";

export function StopwatchCard({ isSample }: CardProps) {
  const s = useStopwatch();
  const running = Boolean(s.startedAt);
  const [now, setNow] = useState(() => Date.now());
  // Tenths only while running and the card is open.
  useInterval(() => setNow(Date.now()), running ? 100 : null);
  const ms = elapsedMs(s, running ? now : Date.now());
  const splits = lapSplits(s.laps);
  const best = splits.length > 1 ? Math.min(...splits) : -1;
  const worst = splits.length > 1 ? Math.max(...splits) : -1;
  const current = ms - (s.laps[s.laps.length - 1] ?? 0);

  return (
    <CardFrame title="Stopwatch" icon={Watch} subtitle="Still counts after you close this card">
      <div className="py-3 text-center">
        <div className="text-[44px] leading-none font-semibold tabular-nums">{stopwatchText(ms)}</div>
        {s.laps.length > 0 && <div className="mt-1 text-[12px] text-dim tabular-nums">Lap {s.laps.length + 1} · {stopwatchText(current)}</div>}
      </div>
      <div className="mb-3 flex justify-center gap-2">
        <Button variant="primary" icon={running ? Pause : Play} onClick={() => !isSample && stopwatchActions.toggle()}>
          {running ? "Pause" : ms ? "Resume" : "Start"}
        </Button>
        <Button icon={Flag} disabled={!running} onClick={() => stopwatchActions.lap()}>
          Lap
        </Button>
        <Button variant="ghost" icon={RotateCcw} disabled={!ms} onClick={() => !isSample && stopwatchActions.reset()}>
          Reset
        </Button>
      </div>
      {s.laps.length === 0 ? (
        <EmptyState icon={Flag} title="No laps yet" message="Laps you record while it runs are listed here until you reset." />
      ) : (
        <div className="g-scroll-y max-h-[240px] overflow-y-auto rounded-xl bg-input px-3 py-1">
          {[...splits].reverse().map((split, ri) => {
            const i = splits.length - 1 - ri;
            return (
              <div key={i} className="flex items-center justify-between border-b border-card-line py-1.5 text-[12.5px] last:border-0 tabular-nums">
                <span className="text-dim">Lap {i + 1}</span>
                <span className={cx("font-medium", split === best && "text-good", split === worst && "text-bad")}>{stopwatchText(split)}</span>
                <span className="text-faint">{stopwatchText(s.laps[i])}</span>
              </div>
            );
          })}
        </div>
      )}
    </CardFrame>
  );
}
