import { CalendarClock } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../../weather/conditions";
import { temp, useWeather } from "../../weather/shared";
import { clockCardSize, ClockShellCard, FormatRow, useHour24, type HourFormat } from "../shared";
import { formatHM, zoned } from "../zones";

type TodayConfig = { format: HourFormat };

function TodayTile({ config, size, isSample }: TileProps<TodayConfig>) {
  const now = useNow("minute");
  const hour24 = useHour24(config.format);
  const w = useWeather({ sample: isSample });
  const t = formatHM(zoned(now, ""), hour24);
  const cur = w.data.current;
  const c = condition(cur.code, cur.isDay);
  const Icon = c.icon;
  const small = Math.max(9, Math.round(size * 0.21));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.18)]" title={`${now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · ${c.label}`}>
      <div className="min-w-0 leading-none">
        <div className="truncate font-semibold text-accent uppercase" style={{ fontSize: small, letterSpacing: "0.04em" }}>
          {now.toLocaleDateString(undefined, { weekday: "long" })}
        </div>
        <div className="mt-[3px] truncate text-dim" style={{ fontSize: small }}>
          {now.toLocaleDateString(undefined, { day: "numeric", month: size >= 52 ? "long" : "short" })}
        </div>
      </div>
      <div className="flex shrink-0 items-baseline gap-[2px] font-semibold tabular-nums leading-none">
        <span style={{ fontSize: Math.round(size * 0.4) }}>{t.main}</span>
        {t.period && (
          <span className="text-dim" style={{ fontSize: Math.round(size * 0.18) }}>
            {t.period}
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-[calc(var(--tile-h)*0.06)]">
        <Icon size={Math.round(size * 0.42)} style={{ color: c.tone }} />
        <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.3) }}>
          {temp(cur.temp, w.units)}
        </span>
      </div>
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function TodayCard({ config, setConfig, close }: CardProps<TodayConfig>) {
  return <ClockShellCard title="Today" icon={CalendarClock} close={close} settings={<FormatRow value={config.format} onChange={(format) => setConfig({ format })} />} />;
}

export default defineWidget<TodayConfig>({
  id: "clocks.today",
  name: "Today",
  category: "Clocks",
  description: "Day, date, time and local weather together on one tile.",
  keywords: ["today", "date", "time", "weather", "weekday"],
  icon: CalendarClock,
  size: "xl",
  Tile: TodayTile,
  Card: TodayCard,
  get cardSize() {
    return clockCardSize();
  },
  defaultConfig: { format: "auto" },
});
