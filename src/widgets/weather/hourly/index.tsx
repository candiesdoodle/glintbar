import { Clock4 } from "lucide-react";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type TileProps, lazyPart } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../conditions";
import { hourLabel, temp, useWeather } from "../shared";
function HourlyTile({ size, isSample }: TileProps) {
  const w = useWeather({ sample: isSample });
  const hour24 = useSettings((s) => s.clock24h);
  const now = useNow("minute").getTime();
  const hours = w.data.hourly.filter((h) => h.time + 3600_000 > now).slice(0, 6);
  const small = Math.max(9, Math.round(size * 0.19));
  return (
    <TileFrame className="justify-between px-[calc(var(--tile-h)*0.16)]" title="Next 6 hours">
      {hours.map((h, i) => {
        const c = condition(h.code, h.isDay);
        const Icon = c.icon;
        return (
          <div key={h.time} className="flex min-w-0 flex-col items-center leading-none" title={`${c.label}, ${Math.round(h.pop)}% rain`}>
            <span className="text-dim" style={{ fontSize: small }}>
              {i === 0 ? "Now" : hourLabel(h.time, w.data.tz, hour24).replace(/:00$/, "")}
            </span>
            <Icon size={Math.round(size * 0.3)} style={{ color: c.tone }} className="my-[2px]" />
            <span className="font-semibold tabular-nums" style={{ fontSize: Math.max(10, Math.round(size * 0.22)) }}>
              {temp(h.temp, w.units)}
            </span>
          </div>
        );
      })}
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget({
  id: "weather.hourly",
  name: "Hourly",
  category: "Weather",
  description: "An hour-by-hour strip covering six hours, with icons and temperatures.",
  keywords: ["hours", "hourly", "forecast", "rain", "temperature"],
  icon: Clock4,
  size: "xl",
  Tile: HourlyTile,
  Card: lazyPart(() => import("../WeatherCard").then((m) => m.WeatherCard)),
  cardSize: { width: 340 },
});
