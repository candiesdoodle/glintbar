import { useEffect, useState } from "react";
import { BellRing, Moon, Play, Volume2, Zap } from "lucide-react";
import { Section } from "../ui/CardFrame";
import { Button, Segmented, SettingRow, Slider, Toggle } from "../ui/controls";
import { cx } from "../ui/cx";
import { useAlerts } from "./alerts";
import { RULES, testAlert } from "./engine";
import { inQuietHours, setRule, updateAutomations, useAutomations, type AlertKind, type AutomationSettings } from "./settings";
import { currentAiLimits, onSignals } from "./signals";
import { playSound, SOUNDS } from "./sounds";

const KIND_LABELS: Array<{ kind: AlertKind; label: string }> = [
  { kind: "timer", label: "Timer" },
  { kind: "pomodoro", label: "Pomodoro" },
  { kind: "calendar", label: "Calendar" },
  { kind: "todo", label: "To-do reminders" },
  { kind: "automation", label: "Automations" },
];

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="h-8 w-[92px] rounded-lg border border-card-line bg-input px-2 text-[13px] text-fg tabular-nums outline-none focus:border-accent"
    />
  );
}

function RuleExtra({ id, s }: { id: (typeof RULES)[number]["id"]; s: AutomationSettings }) {
  if (id === "pauseMusic")
    return <Segmented value={String(s.meetingLeadMin)} options={["0", "1", "2", "5"].map((v) => ({ value: v, label: v === "0" ? "At start" : `${v} min` }))} onChange={(v) => updateAutomations({ meetingLeadMin: Number(v) })} />;
  if (id === "eventHeadsUp")
    return <Segmented value={String(s.eventLeadMin)} options={["5", "10", "15", "30"].map((v) => ({ value: v, label: `${v} min` }))} onChange={(v) => updateAutomations({ eventLeadMin: Number(v) })} />;
  if (id === "aiLimit")
    return <Segmented value={String(s.aiThreshold)} options={["75", "85", "95"].map((v) => ({ value: v, label: `${v}%` }))} onChange={(v) => updateAutomations({ aiThreshold: Number(v) })} />;
  if (id === "renewal")
    return <Segmented value={String(s.renewalLeadDays)} options={["1", "3", "7"].map((v) => ({ value: v, label: `${v} day${v === "1" ? "" : "s"}` }))} onChange={(v) => updateAutomations({ renewalLeadDays: Number(v) })} />;
  if (id === "screenSummary") return <TimeInput label="Summary time" value={s.summaryTime} onChange={(summaryTime) => updateAutomations({ summaryTime })} />;
  return null;
}

/** Settings > Automations. Every rule is one switch; quiet hours and sounds below. */
export function AutomationsSettings() {
  const s = useAutomations();
  const held = useAlerts((x) => x.held.length);
  const [aiSources, setAiSources] = useState(() => currentAiLimits().length);
  useEffect(() => onSignals(() => setAiSources(currentAiLimits().length)), []);
  const quietNow = inQuietHours(s.quiet);

  return (
    <div>
      <p className="mb-3 text-[12.5px] leading-snug text-dim">
        Rules act on data your widgets already collect, entirely on this PC. A rule stays idle until its widget is connected.
      </p>
      <Section title="Rules">
        {RULES.map((r) => (
          <div key={r.id} className="border-b border-card-line py-2.5 last:border-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] text-fg">
                  <Zap size={13} className={s.rules[r.id] ? "text-accent" : "text-faint"} />
                  {r.title}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-dim">{r.description(s)}</div>
                {r.id === "aiLimit" && s.rules.aiLimit && aiSources === 0 && <div className="mt-0.5 text-[11px] text-faint">This rule needs an AI usage widget on the dock.</div>}
              </div>
              <Toggle checked={s.rules[r.id]} onChange={(v) => setRule(r.id, v)} label={r.title} />
            </div>
            {s.rules[r.id] && (
              <div className="mt-2 pl-5">
                <RuleExtra id={r.id} s={s} />
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Quiet hours">
        <SettingRow
          label={
            <span className="flex items-center gap-1.5">
              <Moon size={13} className="text-dim" /> Hold every alert
            </span>
          }
          description={quietNow ? `Quiet now${held ? ` · ${held} alert${held === 1 ? "" : "s"} waiting` : ""}. Held alerts appear once quiet hours are over.` : "Alerts are held during these hours and shown once they end."}
        >
          <Toggle checked={s.quiet.enabled} onChange={(enabled) => updateAutomations({ quiet: { ...s.quiet, enabled } })} label="Quiet hours" />
        </SettingRow>
        {s.quiet.enabled && (
          <SettingRow label="From - to">
            <div className="flex items-center gap-1.5">
              <TimeInput label="From" value={s.quiet.from} onChange={(from) => updateAutomations({ quiet: { ...s.quiet, from } })} />
              <span className="text-dim">-</span>
              <TimeInput label="To" value={s.quiet.to} onChange={(to) => updateAutomations({ quiet: { ...s.quiet, to } })} />
            </div>
          </SettingRow>
        )}
      </Section>

      <Section title="Alert sound">
        <div className="grid grid-cols-4 gap-1.5 py-2.5">
          {[{ id: "none" as const, label: "None" }, ...SOUNDS].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                updateAutomations({ sound: o.id });
                if (o.id !== "none") playSound(o.id, s.volume);
              }}
              className={cx("g-press flex h-9 items-center justify-center gap-1 rounded-lg text-[12px]", s.sound === o.id ? "bg-accent text-on-accent" : "bg-card text-fg hover:bg-hover")}
            >
              {o.id !== "none" && <Play size={11} fill="currentColor" />}
              {o.label}
            </button>
          ))}
        </div>
        <SettingRow label={<span className="flex items-center gap-1.5"><Volume2 size={13} className="text-dim" /> Volume</span>}>
          <div className="w-[160px]">
            <Slider value={Math.round(s.volume * 100)} onChange={(v) => updateAutomations({ volume: v / 100 })} label="Alert volume" />
          </div>
        </SettingRow>
        <div className="border-t border-card-line py-2.5">
          <div className="mb-1.5 text-[12px] text-dim">Play it for</div>
          <div className="flex flex-wrap gap-1.5">
            {KIND_LABELS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                aria-pressed={s.soundFor[kind]}
                onClick={() => updateAutomations({ soundFor: { ...s.soundFor, [kind]: !s.soundFor[kind] } })}
                className={cx("g-press h-7 rounded-full px-3 text-[12px]", s.soundFor[kind] ? "bg-accent/20 text-accent" : "bg-card text-dim hover:text-fg")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>
      <Button icon={BellRing} onClick={testAlert}>
        Show a test alert
      </Button>
    </div>
  );
}
