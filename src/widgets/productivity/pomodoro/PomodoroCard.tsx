import { Pause, Play, SkipForward, Square, Target } from "lucide-react";
import { duration, timeOfDay } from "../../../core/format";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, Ring, SampleBadge, Section, Segmented, SettingRow, Stat, Toggle } from "../../../ui";
import { clock, startOfDay } from "../shared/time";
import { focusOn, isPaused, leftMs, PHASE_LABEL, phaseColor, phaseMs, pomodoroActions, sampleHistory, usePomodoro, type PomodoroSettings } from "./store";

export function PomodoroCard({ isSample }: CardProps) {
  const s = usePomodoro();
  const hour24 = useSettings((x) => x.clock24h);
  const now = useNow("second").getTime();
  const history = isSample ? sampleHistory(now) : s.history;
  const left = leftMs(s, now);
  const total = s.phase === "idle" ? phaseMs(s.next, s.settings) : phaseMs(s.phase, s.settings);
  const today = startOfDay(now);
  const todays = focusOn(history, today);
  const doneToday = todays.filter((h) => h.done).length;
  const focusMsToday = todays.reduce((a, h) => a + (Math.min(h.end, now) - Math.max(h.start, today)), 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = today - (6 - i) * 86_400_000;
    const ms = focusOn(history, d).reduce((a, h) => a + (Math.min(h.end, d + 86_400_000) - Math.max(h.start, d)), 0);
    return { d, ms };
  });
  const maxWeek = Math.max(25 * 60_000, ...week.map((w) => w.ms));
  const recent = [...history].reverse().slice(0, 6);
  const paused = isPaused(s);
  const set = (patch: Partial<PomodoroSettings>) => !isSample && pomodoroActions.setSettings(patch);

  return (
    <CardFrame title="Pomodoro" icon={Target} subtitle={`${s.settings.focusMin} min focus · ${s.settings.shortMin} min breaks`} actions={isSample ? <SampleBadge /> : undefined}>
      <div className="flex items-center gap-4 py-1">
        <Ring value={s.phase === "idle" ? 0 : total - left} max={total} size={124} stroke={9} color={phaseColor(s.phase)}>
          <div className="text-center">
            <div className="text-[26px] font-semibold tabular-nums">{clock(left / 1000)}</div>
            <div className="text-[11.5px] text-dim">{s.phase === "idle" ? `Next: ${PHASE_LABEL[s.next]}` : paused ? "Paused" : PHASE_LABEL[s.phase]}</div>
          </div>
        </Ring>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex gap-1">
            {Array.from({ length: s.settings.longEvery }, (_, i) => (
              <span key={i} className={cx("h-2 flex-1 rounded-full", i < s.round % s.settings.longEvery || (s.phase === "long" && i < s.settings.longEvery) ? "bg-bad" : i === s.round % s.settings.longEvery && s.phase === "focus" ? "bg-bad/50" : "bg-track")} />
            ))}
          </div>
          <Button variant="primary" icon={s.endsAt ? Pause : Play} onClick={() => !isSample && pomodoroActions.toggle()}>
            {s.phase === "idle" ? `Start ${PHASE_LABEL[s.next].toLowerCase()}` : s.endsAt ? "Pause" : "Resume"}
          </Button>
          <div className="flex gap-2">
            <Button className="flex-1" icon={SkipForward} onClick={() => !isSample && pomodoroActions.skip()}>
              Skip
            </Button>
            <Button className="flex-1" variant="ghost" icon={Square} disabled={s.phase === "idle" && s.round === 0} onClick={() => !isSample && pomodoroActions.stop()}>
              Stop
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-input p-3">
        <Stat label="Rounds today" value={doneToday} />
        <Stat label="Focus today" value={duration(focusMsToday / 1000)} />
        <Stat label="This week" value={duration(week.reduce((a, w) => a + w.ms, 0) / 1000)} />
      </div>

      <Section title="Last 7 days" className="mt-3">
        <div className="flex h-[74px] items-end gap-1.5 pt-3 pb-2">
          {week.map((w) => (
            <div key={w.d} className="flex flex-1 flex-col items-center gap-1" title={`${new Date(w.d).toLocaleDateString(undefined, { weekday: "long" })}: ${duration(w.ms / 1000)}`}>
              <div className="w-full rounded-[4px] bg-bad/80" style={{ height: Math.max(2, (w.ms / maxWeek) * 40), opacity: w.d === today ? 1 : 0.55 }} />
              <span className={cx("text-[10px]", w.d === today ? "text-fg" : "text-faint")}>{new Date(w.d).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
            </div>
          ))}
        </div>
      </Section>

      {recent.length > 0 && (
        <Section title="History">
          {recent.map((h, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-card-line py-1.5 text-[12px] last:border-0">
              <span className={cx("h-2 w-2 shrink-0 rounded-full", h.kind === "focus" ? "bg-bad" : "bg-good")} />
              <span className="flex-1 text-fg">{h.kind === "focus" ? "Focus" : "Break"}{h.done ? "" : " (cut short)"}</span>
              <span className="text-dim tabular-nums">{new Date(h.start).toLocaleDateString(undefined, { weekday: "short" })} {timeOfDay(new Date(h.start), { hour24 })}</span>
              <span className="w-12 text-right text-dim tabular-nums">{duration((h.end - h.start) / 1000)}</span>
            </div>
          ))}
        </Section>
      )}

      <Section title="Lengths" className="mb-0">
        <SettingRow label="Focus">
          <Segmented value={String(s.settings.focusMin)} options={["15", "25", "45", "50"].map((v) => ({ value: v, label: `${v}m` }))} onChange={(v) => set({ focusMin: Number(v) })} />
        </SettingRow>
        <SettingRow label="Short break">
          <Segmented value={String(s.settings.shortMin)} options={["3", "5", "10"].map((v) => ({ value: v, label: `${v}m` }))} onChange={(v) => set({ shortMin: Number(v) })} />
        </SettingRow>
        <SettingRow label="Long break" description={`Once per ${s.settings.longEvery} focus rounds`}>
          <Segmented value={String(s.settings.longMin)} options={["10", "15", "30"].map((v) => ({ value: v, label: `${v}m` }))} onChange={(v) => set({ longMin: Number(v) })} />
        </SettingRow>
        <SettingRow label="Begin breaks automatically">
          <Toggle checked={s.settings.autoBreak} onChange={(v) => set({ autoBreak: v })} />
        </SettingRow>
        <SettingRow label="Begin focus automatically after breaks">
          <Toggle checked={s.settings.autoFocus} onChange={(v) => set({ autoFocus: v })} />
        </SettingRow>
      </Section>
    </CardFrame>
  );
}
