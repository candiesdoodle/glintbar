/**
 * Shared by the clock widgets: 12/24-hour preferences, the card every clock and date opens
 * (the Calendar card from the productivity slice when it is installed, else a month card) and
 * the settings rows.
 */
import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, type LucideIcon } from "lucide-react";
import { useIsSample } from "../../core/connections";
import { isoWeek, longDate, timeParts } from "../../core/format";
import { getWidget, loadWidget } from "../../core/registry";
import { useSettings, useStored } from "../../core/store";
import { useNow } from "../../core/useVisible";
import type { WidgetDef } from "../../core/widget";
import { CardFrame, cx, Section, Segmented, SettingRow } from "../../ui";
import { MonthGrid } from "./MonthGrid";

export type HourFormat = "auto" | "12" | "24";

/** "auto" follows Settings > General > Clock. */
export function useHour24(format: HourFormat | undefined): boolean {
  const clock24h = useSettings((s) => s.clock24h);
  return !format || format === "auto" ? clock24h : format === "24";
}

// Clock cards open the Calendar card: load its (code-split) widget as soon as a clock loads.
void loadWidget("productivity.calendar");

/** The Calendar widget from the productivity slice, if it exists (looked up at render time). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findCalendar(): WidgetDef<any> | undefined {
  const cal = getWidget("productivity.calendar");
  return cal?.Card ? cal : undefined;
}

/** Card size for clocks: as wide as the Calendar card when there is one. */
export function clockCardSize(): { width: number; height?: number } {
  const cal = findCalendar();
  return cal?.cardSize ? { width: Math.max(300, cal.cardSize.width), height: cal.cardSize.height } : { width: 300 };
}

export function FormatRow({ value, onChange }: { value: HourFormat; onChange: (v: HourFormat) => void }) {
  return (
    <SettingRow label="Format">
      <Segmented<HourFormat>
        value={value}
        options={[
          { value: "auto", label: "Auto" },
          { value: "12", label: "12h" },
          { value: "24", label: "24h" },
        ]}
        onChange={onChange}
      />
    </SettingRow>
  );
}

/**
 * What a click on a clock or date opens. With the productivity Calendar installed this is its
 * card (dates and events ahead) with this tile's settings folded underneath; otherwise a
 * month card.
 */
export function ClockShellCard({ title, icon, settings, close }: { title: string; icon?: LucideIcon; settings?: ReactNode; close: () => void }) {
  const cal = findCalendar();
  if (cal?.Card) return <ForeignCalendar def={cal} title={title} settings={settings} close={close} />;
  return <MonthCard title={title} icon={icon} settings={settings} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ForeignCalendar({ def, title, settings, close }: { def: WidgetDef<any>; title: string; settings?: ReactNode; close: () => void }) {
  const [saved, setSaved] = useStored<Record<string, unknown>>("clocks.calendarConfig", {});
  const isSample = useIsSample(def);
  const [open, setOpen] = useState(false);
  const Card = def.Card!;
  const config = { ...(def.defaultConfig ?? {}), ...saved };
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <Card instanceId="clocks:calendar" config={config} setConfig={(p: Record<string, unknown>) => setSaved((c) => ({ ...c, ...p }))} close={close} isSample={isSample} />
      </div>
      {settings && (
        <div className="border-t border-card-line px-4">
          <button type="button" className="flex w-full items-center justify-between py-2.5 text-[12px] text-dim hover:text-fg" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {title} settings
            <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} />
          </button>
          {open && <Section className="mb-3">{settings}</Section>}
        </div>
      )}
    </div>
  );
}

function MonthCard({ title, icon, settings }: { title: string; icon?: LucideIcon; settings?: ReactNode }) {
  const hour24 = useSettings((s) => s.clock24h);
  const now = useNow("second");
  const t = timeParts(now, hour24);
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;
  return (
    <CardFrame title={title} subtitle={longDate(now)} icon={icon ?? CalendarDays}>
      <div className="mb-1 flex items-baseline gap-1 font-semibold tabular-nums">
        <span className="text-[34px] leading-none">{t.main}</span>
        <span className="text-[18px] text-dim">:{t.seconds}</span>
        {t.period && <span className="text-[14px] text-dim">{t.period}</span>}
      </div>
      <div className="mb-3 text-[12px] text-dim">
        Week {isoWeek(now)} · Day {dayOfYear}
      </div>
      <MonthGrid today={now} />
      {settings && (
        <Section title="This tile" className="mt-3 mb-0">
          {settings}
        </Section>
      )}
    </CardFrame>
  );
}
