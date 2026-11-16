import { LayoutGrid } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../../weather/conditions";
import { temp, useWeather } from "../../weather/shared";
import { tempColor } from "../../weather/WeatherCard";
import { clockCardSize, ClockShellCard, FormatRow, useHour24, type HourFormat } from "../shared";
import { formatHM, zoned } from "../zones";

type ClockWeatherConfig = { format: HourFormat };

function ClockWeatherTile({ config, size, isSample }: TileProps<ClockWeatherConfig>) {
  const now = useNow("minute");
  const hour24 = useHour24(config.format);
  const w = useWeather({ sample: isSample });
  const t = formatHM(zoned(now, ""), hour24);
  const c = condition(w.data.current.code, w.data.current.isDay);
  const gap = Math.max(1, Math.round(size * 0.04));
  const radius = Math.max(3, Math.round(size * 0.12));
  const text = "text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.25)]";
  return (
    <TileFrame padded={false} title={`${now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · ${c.label}`}>
      <div className="grid h-full w-full grid-cols-2 grid-rows-2" style={{ gap, padding: gap }}>
        <div className={`col-span-2 grid place-items-center font-bold tabular-nums leading-none ${text}`} style={{ borderRadius: radius, background: "var(--g-accent)", fontSize: Math.round(size * (t.main.length > 4 ? 0.24 : 0.29)) }}>
          {t.main}
        </div>
        <div className={`flex flex-col items-center justify-center leading-none ${text}`} style={{ borderRadius: radius, background: "#ff9f0a" }}>
          <span className="font-semibold uppercase" style={{ fontSize: Math.max(6, Math.round(size * 0.13)) }}>
            {now.toLocaleDateString(undefined, { weekday: "short" }).replace(".", "")}
          </span>
          <span className="font-bold tabular-nums" style={{ fontSize: Math.max(7, Math.round(size * 0.18)) }}>
            {now.getDate()}
          </span>
        </div>
        <div className={`grid place-items-center font-bold tabular-nums leading-none ${text}`} style={{ borderRadius: radius, background: tempColor(w.data.current.temp), fontSize: Math.max(7, Math.round(size * 0.2)) }}>
          {temp(w.data.current.temp, w.units)}
        </div>
      </div>
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function ClockWeatherCard({ config, setConfig, close }: CardProps<ClockWeatherConfig>) {
  return <ClockShellCard title="Clock & Weather" icon={LayoutGrid} close={close} settings={<FormatRow value={config.format} onChange={(format) => setConfig({ format })} />} />;
}

export default defineWidget<ClockWeatherConfig>({
  id: "clocks.clockweather",
  name: "Clock & Weather",
  category: "Clocks",
  description: "A square tile in coloured blocks: time, date and temperature.",
  keywords: ["time", "date", "temperature", "weather", "square", "blocks"],
  icon: LayoutGrid,
  size: "s",
  Tile: ClockWeatherTile,
  Card: ClockWeatherCard,
  get cardSize() {
    return clockCardSize();
  },
  defaultConfig: { format: "auto" },
});
