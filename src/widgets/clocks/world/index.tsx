import { useState } from "react";
import { Earth, Pencil, X } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, cx, IconButton, Section, TileFrame } from "../../../ui";
import { AnalogFace } from "../AnalogFace";
import { FormatRow, useHour24, type HourFormat } from "../shared";
import { ZonePicker } from "../ZonePicker";
import { dayRelation, formatHM, offsetLabel, zoned, type ClockCity } from "../zones";

type WorldConfig = { cities: ClockCity[]; format: HourFormat };

const DEFAULT_CITIES: ClockCity[] = [
  { name: "London", tz: "Europe/London", country: "United Kingdom" },
  { name: "New York", tz: "America/New_York", country: "United States" },
  { name: "Tokyo", tz: "Asia/Tokyo", country: "Japan" },
];

/** "5:30 h behind", "3 h ahead", "same time". */
function aheadText(minutes: number): string {
  if (minutes === 0) return "Same as local time";
  return `${offsetLabel(Math.abs(minutes)).slice(1)}h ${minutes > 0 ? "ahead" : "behind"}`;
}

function isNight(hour: number): boolean {
  return hour < 6 || hour >= 20;
}

function WorldTile({ config, size }: TileProps<WorldConfig>) {
  const now = useNow("minute");
  const hour24 = useHour24(config.format);
  const cities = (config.cities?.length ? config.cities : DEFAULT_CITIES).slice(0, 3);
  const face = Math.round(size * 0.6);
  const label = Math.max(8, Math.round(size * 0.19));
  return (
    <TileFrame className="justify-around px-[calc(var(--tile-h)*0.08)]">
      {cities.map((c, i) => {
        const p = zoned(now, c.tz);
        const night = isNight(p.hour);
        const t = formatHM(p, hour24);
        return (
          <div key={i} className="flex min-w-0 flex-col items-center gap-[2px] leading-none" title={`${c.name}: ${t.main}${t.period ? ` ${t.period}` : ""}`}>
            <AnalogFace
              hour={p.hour}
              minute={p.minute}
              size={face}
              face={night ? "rgba(0,0,0,0.35)" : "var(--g-input)"}
              hands={night ? "var(--g-dim)" : "var(--g-fg)"}
              ticks={night ? "var(--g-faint)" : "var(--g-dim)"}
            />
            <span className="max-w-full truncate text-dim" style={{ fontSize: label }}>
              {c.name}
            </span>
          </div>
        );
      })}
    </TileFrame>
  );
}

function WorldCard({ config, setConfig }: CardProps<WorldConfig>) {
  const now = useNow("minute");
  const hour24 = useHour24(config.format);
  const cities = (config.cities?.length ? config.cities : DEFAULT_CITIES).slice(0, 3);
  const [editing, setEditing] = useState<number | null>(null);
  const local = zoned(now, "");
  return (
    <CardFrame title="World Clocks" subtitle="Your three chosen cities" icon={Earth}>
      <Section>
        {cities.map((c, i) => {
          const p = zoned(now, c.tz);
          const t = formatHM(p, hour24);
          const rel = dayRelation(p, now);
          return (
            <div key={i} className={cx("py-2.5", i > 0 && "border-t border-card-line")}>
              <div className="flex items-center gap-3">
                <AnalogFace hour={p.hour} minute={p.minute} size={34} face={isNight(p.hour) ? "rgba(0,0,0,0.35)" : "var(--g-track)"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{c.name}</div>
                  <div className="truncate text-[11.5px] text-dim">
                    {aheadText(p.offset - local.offset)}
                    {rel && rel !== "Today" ? ` · ${rel.toLowerCase()}` : ""}
                  </div>
                </div>
                <div className="text-right font-semibold tabular-nums">
                  <span className="text-[18px]">{t.main}</span>
                  {t.period && <span className="ml-0.5 text-[11px] text-dim">{t.period}</span>}
                </div>
                <IconButton icon={editing === i ? X : Pencil} label={editing === i ? "Cancel" : `Change ${c.name}`} onClick={() => setEditing(editing === i ? null : i)} />
              </div>
              {editing === i && (
                <ZonePicker
                  autoFocus
                  onPick={(city) => {
                    const next = [...cities];
                    next[i] = city;
                    setConfig({ cities: next });
                    setEditing(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </Section>
      <Section title="Settings" className="mb-0">
        <FormatRow value={config.format} onChange={(format) => setConfig({ format })} />
      </Section>
    </CardFrame>
  );
}

export default defineWidget<WorldConfig>({
  id: "clocks.world",
  name: "World Clocks",
  category: "Clocks",
  description: "Three mini analog clocks, each set to a city of your choice.",
  keywords: ["world", "time zone", "cities", "analog", "international", "team"],
  icon: Earth,
  size: "l",
  Tile: WorldTile,
  Card: WorldCard,
  cardSize: { width: 330 },
  defaultConfig: { cities: DEFAULT_CITIES, format: "auto" },
});
