import { CalendarDays } from "lucide-react";
import { defineWidget, type TileProps, lazyPart } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../conditions";
import { temp, useWeather, weekdayLabel } from "../shared";
function ForecastTile({ size, isSample }: TileProps) {
  const w = useWeather({ sample: isSample });
  const cur = w.data.current;
  const now = Date.now();
  const idx = Math.max(0, w.data.daily.findIndex((d) => now >= d.date && now < d.date + 86_400_000));
  const next = w.data.daily.slice(idx + 1, idx + 4);
  const c = condition(cur.code, cur.isDay);
  const Icon = c.icon;
  const small = Math.max(9, Math.round(size * 0.2));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.12)] pr-[calc(var(--tile-h)*0.12)]" title={c.label}>
      <div className="flex shrink-0 items-center gap-[calc(var(--tile-h)*0.1)]">
        <Icon size={Math.round(size * 0.56)} style={{ color: c.tone }} strokeWidth={1.8} />
        <div className="leading-none">
          <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.38) }}>
            {temp(cur.temp, w.units)}
          </div>
          <div className="mt-[3px] text-dim" style={{ fontSize: small }}>
            Today
          </div>
        </div>
      </div>
      <div className="h-[56%] w-px shrink-0 bg-line" />
      <div className="flex min-w-0 flex-1 justify-between">
        {next.map((d) => {
          const dc = condition(d.code, true);
          const DIcon = dc.icon;
          return (
            <div key={d.date} className="flex min-w-0 flex-col items-center leading-none" title={`${weekdayLabel(d.date, w.data.tz, "long")}: ${dc.label}`}>
              <span className="text-dim" style={{ fontSize: small }}>
                {weekdayLabel(d.date, w.data.tz)}
              </span>
              <DIcon size={Math.round(size * 0.3)} style={{ color: dc.tone }} className="my-[2px]" />
              <span className="font-medium tabular-nums" style={{ fontSize: small }}>
                {temp(d.max, w.units)}
                {size >= 40 && <span className="text-faint"> {temp(d.min, w.units)}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget({
  id: "weather.forecast",
  name: "Today & Forecast",
  category: "Weather",
  description: "Current conditions on the left, the following three days on the right.",
  keywords: ["forecast", "week", "days", "tomorrow", "temperature"],
  icon: CalendarDays,
  size: "xl",
  Tile: ForecastTile,
  Card: lazyPart(() => import("../WeatherCard").then((m) => m.WeatherCard)),
  cardSize: { width: 340 },
});
