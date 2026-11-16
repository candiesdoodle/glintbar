import { useState } from "react";
import { BookmarkPlus, Pause, Play, Plus, RotateCcw, Timer, X } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, Ring, Section } from "../../../ui";
import { clock } from "../shared/time";
import { presetLabel, timerActions, timerLeftMs, timerStatus, useTimer } from "./store";

function Field({ value, max, label, onChange }: { value: number; max: number; label: string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col items-center gap-1">
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
        onFocus={(e) => e.target.select()}
        className="h-12 w-16 rounded-xl border border-card-line bg-input text-center text-[22px] font-semibold tabular-nums text-fg outline-none focus:border-accent"
        aria-label={label}
      />
      <span className="text-[11px] text-dim">{label}</span>
    </label>
  );
}

export function TimerCard({ isSample }: CardProps) {
  const s = useTimer();
  const st = timerStatus(s);
  const now = useNow("second").getTime();
  const left = timerLeftMs(s, now);
  const initial = Math.round(s.totalMs / 1000);
  const [h, setH] = useState(Math.floor(initial / 3600));
  const [m, setM] = useState(Math.floor((initial % 3600) / 60));
  const [sec, setSec] = useState(initial % 60);
  const typed = h * 3600 + m * 60 + sec;
  const busy = st === "running" || st === "paused";

  return (
    <CardFrame title="Timer" icon={Timer} subtitle={st === "running" ? `Ends at ${new Date(s.endsAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Closing this card does not stop it"}>
      {busy || st === "finished" ? (
        <div className="flex flex-col items-center py-2">
          <Ring value={s.totalMs - left} max={s.totalMs} size={168} stroke={10} color={st === "paused" ? "var(--g-warn)" : st === "finished" ? "var(--g-good)" : "var(--g-accent)"}>
            <div className="text-center">
              <div className="text-[34px] font-semibold tabular-nums">{clock(left / 1000)}</div>
              <div className="text-[12px] text-dim">{st === "paused" ? "Paused" : st === "finished" ? "Done" : presetLabel(Math.round(s.totalMs / 1000))}</div>
            </div>
          </Ring>
          <div className="mt-3 flex gap-2">
            {st !== "finished" && (
              <Button variant="primary" icon={st === "running" ? Pause : Play} onClick={() => !isSample && timerActions.toggle()}>
                {st === "running" ? "Pause" : "Resume"}
              </Button>
            )}
            {st !== "finished" && (
              <Button icon={Plus} onClick={() => !isSample && timerActions.add(60)}>
                1 min
              </Button>
            )}
            {st === "finished" && (
              <Button variant="primary" icon={RotateCcw} onClick={() => !isSample && timerActions.start(s.totalMs / 1000)}>
                Again
              </Button>
            )}
            <Button variant="ghost" icon={X} onClick={() => !isSample && timerActions.reset()}>
              {st === "finished" ? "Close" : "Cancel"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center py-2">
          <div className="flex items-start gap-2">
            <Field value={h} max={99} label="hours" onChange={setH} />
            <span className="pt-2 text-[22px] text-faint">:</span>
            <Field value={m} max={59} label="minutes" onChange={setM} />
            <span className="pt-2 text-[22px] text-faint">:</span>
            <Field value={sec} max={59} label="seconds" onChange={setSec} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Play} disabled={typed <= 0} onClick={() => !isSample && timerActions.start(typed)}>
              Start
            </Button>
            <Button icon={BookmarkPlus} disabled={typed <= 0 || s.presets.includes(typed)} onClick={() => !isSample && timerActions.savePreset(typed)}>
              Save length
            </Button>
          </div>
        </div>
      )}
      <Section title="Your lengths" className="mt-3 mb-0">
        <div className="flex flex-wrap gap-1.5 py-2.5">
          {s.presets.length === 0 && <span className="text-[12px] text-dim">Lengths you save appear here as one-click starts.</span>}
          {s.presets.map((p) => (
            <span key={p} className="group inline-flex items-center overflow-hidden rounded-lg bg-card">
              <button
                type="button"
                className={cx("g-press h-7 px-2.5 text-[12px] font-medium hover:bg-hover", Math.round(s.totalMs / 1000) === p && "text-accent")}
                onClick={() => {
                  if (isSample) return;
                  setH(Math.floor(p / 3600));
                  setM(Math.floor((p % 3600) / 60));
                  setSec(p % 60);
                  timerActions.start(p);
                }}
                title="Start"
              >
                {presetLabel(p)}
              </button>
              <button type="button" aria-label={`Remove ${presetLabel(p)}`} className="hidden h-7 px-1 text-faint group-hover:block hover:text-bad" onClick={() => !isSample && timerActions.removePreset(p)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </Section>
    </CardFrame>
  );
}
