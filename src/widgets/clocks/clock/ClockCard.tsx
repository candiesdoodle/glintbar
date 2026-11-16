import { useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { isoWeek, longDate, timeParts } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { CardProps } from "../../../core/widget";
import { CardFrame, cx, IconButton, Section, Segmented, SettingRow, Toggle } from "../../../ui";
import { useClockPrefs, type ClockConfig } from "./config";

export function ClockCard({ config, setConfig }: CardProps<ClockConfig>) {
  const { hour24 } = useClockPrefs(config);
  const now = useNow("second");
  const t = timeParts(now, hour24);
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;
  const daysInYear = new Date(now.getFullYear(), 1, 29).getDate() === 29 ? 366 : 365;

  return (
    <CardFrame title="Clock" subtitle={longDate(now)} icon={Clock}>
      <div className="mb-1 flex items-baseline gap-1 font-semibold tabular-nums">
        <span className="text-[40px] leading-none">{t.main}</span>
        <span className="text-[22px] text-dim">:{t.seconds}</span>
        {t.period && <span className="text-[16px] text-dim">{t.period}</span>}
      </div>
      <div className="mb-3 text-[12px] text-dim">
        Week {isoWeek(now)} · Day {dayOfYear} of {daysInYear}
      </div>
      <MonthGrid today={now} />
      <Section title="This clock" className="mt-3 mb-0">
        <SettingRow label="Format">
          <Segmented
            value={config.format}
            options={[
              { value: "auto", label: "Auto" },
              { value: "12", label: "12h" },
              { value: "24", label: "24h" },
            ]}
            onChange={(format) => setConfig({ format })}
          />
        </SettingRow>
        <SettingRow label="Seconds">
          <Segmented
            value={config.seconds}
            options={[
              { value: "auto", label: "Auto" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
            onChange={(seconds) => setConfig({ seconds })}
          />
        </SettingRow>
        <SettingRow label="Show the date">
          <Toggle checked={config.showDate} onChange={(showDate) => setConfig({ showDate })} />
        </SettingRow>
      </Section>
    </CardFrame>
  );
}

/** A Monday-first month calendar with today marked. */
function MonthGrid({ today }: { today: Date }) {
  const [offset, setOffset] = useState(0);
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isThisMonth = first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth();
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

  return (
    <div className="rounded-xl bg-input p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setOffset((o) => o - 1)} />
        <button type="button" className="text-[13px] font-medium" onClick={() => setOffset(0)}>
          {first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </button>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => setOffset((o) => o + 1)} />
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11.5px] tabular-nums">
        {weekdays.map((d, i) => (
          <div key={i} className="pb-1 text-[10.5px] text-faint">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="grid h-7 place-items-center">
            {d && (
              <span className={cx("grid h-6 w-6 place-items-center rounded-full", isThisMonth && d === today.getDate() ? "bg-accent font-semibold text-on-accent" : "text-fg")}>{d}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
