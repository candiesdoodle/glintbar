import { Thermometer, Umbrella, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { defineWidget, type TileProps, lazyPart } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../conditions";
import { temp, today, useWeather, wind } from "../shared";
function Item({ icon: Icon, value, unit, label, size, color }: { icon: LucideIcon; value: string; unit?: string; label: string; size: number; color: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center leading-none" title={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <Icon size={Math.round(size * 0.3)} style={{ color }} className="shrink-0" />
      <div className="mt-[3px] max-w-full truncate font-semibold tabular-nums" style={{ fontSize: Math.max(10, Math.round(size * 0.24)) }}>
        {value}
        {unit && <span className="ml-[1px] font-normal text-dim" style={{ fontSize: Math.max(7, Math.round(size * 0.15)) }}>{unit}</span>}
      </div>
      {size >= 52 && (
        <div className="mt-[2px] text-faint" style={{ fontSize: Math.round(size * 0.16) }}>
          {label}
        </div>
      )}
    </div>
  );
}

function DetailsTile({ size, isSample }: TileProps) {
  const w = useWeather({ sample: isSample });
  const day = today(w.data);
  const cur = w.data.current;
  const c = condition(cur.code, cur.isDay);
  return (
    <TileFrame className="gap-1 px-[calc(var(--tile-h)*0.12)]" title={c.label}>
      <Item icon={Wind} value={wind(cur.wind, w.windUnits).split(" ")[0]} unit={wind(cur.wind, w.windUnits).split(" ")[1]} label="Wind" size={size} color="var(--g-dim)" />
      <div className="h-1/2 w-px shrink-0 bg-line" />
      <Item icon={Umbrella} value={`${Math.round(day?.pop ?? 0)}%`} label="Rain" size={size} color="#4ea3ff" />
      <div className="h-1/2 w-px shrink-0 bg-line" />
      <Item icon={Thermometer} value={day ? `${temp(day.min, w.units).replace("°", "")}–${temp(day.max, w.units)}` : "–"} label="Today" size={size} color="#f59a3c" />
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget({
  id: "weather.details",
  name: "Weather Details",
  category: "Weather",
  description: "Wind speed, rain probability and today's low-to-high temperatures.",
  keywords: ["wind", "rain", "precipitation", "range", "humidity"],
  icon: Wind,
  size: "xl",
  Tile: DetailsTile,
  Card: lazyPart(() => import("../WeatherCard").then((m) => m.WeatherCard)),
  cardSize: { width: 340 },
});
