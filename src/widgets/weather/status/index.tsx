import { MessageSquareText } from "lucide-react";
import { defineWidget, type TileProps, lazyPart } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../conditions";
import { placeLabel, temp, useWeather } from "../shared";
function StatusTile({ size, isSample }: TileProps) {
  const w = useWeather({ sample: isSample });
  const cur = w.data.current;
  const c = condition(cur.code, cur.isDay);
  const Icon = c.icon;
  const city = w.isSample && !isSample ? "Pick your city" : placeLabel(w.place) || w.data.place.name;
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.14)]" title={`${c.label} in ${city}`}>
      <Icon size={Math.round(size * 0.52)} style={{ color: c.tone }} strokeWidth={1.8} className="shrink-0" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-semibold" style={{ fontSize: Math.max(10, Math.round(size * 0.28)) }}>
          {c.label}
        </div>
        <div className="truncate text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
          {city} · {temp(cur.temp, w.units)}
        </div>
      </div>
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget({
  id: "weather.status",
  name: "Weather Status",
  category: "Weather",
  description: "A short text summary of the weather where you are, with the city name.",
  keywords: ["conditions", "rain", "sunny", "cloudy", "city", "words"],
  icon: MessageSquareText,
  size: "l",
  Tile: StatusTile,
  Card: lazyPart(() => import("../WeatherCard").then((m) => m.WeatherCard)),
  cardSize: { width: 340 },
});
