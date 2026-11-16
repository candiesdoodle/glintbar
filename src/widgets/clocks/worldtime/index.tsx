import { useState } from "react";
import { Globe } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { Button, CardFrame, Section, SettingRow, TileFrame } from "../../../ui";
import { FormatRow, useHour24, type HourFormat } from "../shared";
import { ZonePicker } from "../ZonePicker";
import { dayRelation, formatHM, offsetLabel, zoned, type ClockCity } from "../zones";

type WorldTimeConfig = { city: ClockCity; format: HourFormat };

function relOffset(now: Date, tz: string): string {
  const d = zoned(now, tz).offset - zoned(now, "").offset;
  return d === 0 ? "±0" : `${offsetLabel(d)}h`;
}

function WorldTimeTile({ config, size }: TileProps<WorldTimeConfig>) {
  const now = useNow("minute");
  const hour24 = useHour24(config.format);
  const p = zoned(now, config.city.tz);
  const t = formatHM(p, hour24);
  const small = Math.max(9, Math.round(size * 0.21));
  return (
    <TileFrame className="flex-col items-start justify-center leading-none" title={`${config.city.name}, ${relOffset(now, config.city.tz)} from here`}>
      <div className="flex w-full min-w-0 items-baseline gap-1" style={{ fontSize: small }}>
        <span className="truncate text-dim">{config.city.name}</span>
        {size >= 40 && <span className="shrink-0 font-medium text-accent tabular-nums">{relOffset(now, config.city.tz)}</span>}
      </div>
      <div className="mt-[3px] flex items-baseline gap-[2px] font-semibold tabular-nums">
        <span style={{ fontSize: Math.round(size * 0.42) }}>{t.main}</span>
        {t.period && (
          <span className="text-dim" style={{ fontSize: Math.round(size * 0.2) }}>
            {t.period}
          </span>
        )}
      </div>
    </TileFrame>
  );
}

function WorldTimeCard({ config, setConfig }: CardProps<WorldTimeConfig>) {
  const now = useNow("minute");
  const hour24 = useHour24(config.format);
  const p = zoned(now, config.city.tz);
  const t = formatHM(p, hour24);
  const [picking, setPicking] = useState(false);
  const rel = dayRelation(p, now);
  const date = new Date(Date.UTC(p.year, p.month, p.day, 12)).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <CardFrame title={config.city.name} subtitle={config.city.country ?? config.city.tz} icon={Globe}>
      <div className="flex items-baseline gap-1 font-semibold tabular-nums">
        <span className="text-[40px] leading-none">{t.main}</span>
        {t.period && <span className="text-[16px] text-dim">{t.period}</span>}
      </div>
      <div className="mt-1 mb-3 text-[12px] text-dim">
        {date}
        {rel && rel !== "Today" ? ` (${rel.toLowerCase()})` : ""} · {relOffset(now, config.city.tz)} from here · UTC{offsetLabel(p.offset)}
      </div>
      <Section title="Settings" className="mb-0">
        <SettingRow label="City" description={config.city.tz}>
          <Button size="sm" onClick={() => setPicking((v) => !v)}>
            {picking ? "Cancel" : "Change"}
          </Button>
        </SettingRow>
        {picking && (
          <ZonePicker
            autoFocus
            onPick={(city) => {
              setConfig({ city });
              setPicking(false);
            }}
          />
        )}
        <FormatRow value={config.format} onChange={(format) => setConfig({ format })} />
      </Section>
    </CardFrame>
  );
}

export default defineWidget<WorldTimeConfig>({
  id: "clocks.worldtime",
  name: "World Time",
  category: "Clocks",
  description: "Another city's time in large digits, with its offset from yours.",
  keywords: ["world", "time zone", "city", "offset", "international"],
  icon: Globe,
  size: "m",
  Tile: WorldTimeTile,
  Card: WorldTimeCard,
  cardSize: { width: 310 },
  defaultConfig: { city: { name: "New York", tz: "America/New_York", country: "United States" }, format: "auto" },
});
