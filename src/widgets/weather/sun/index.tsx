import { Sunrise } from "lucide-react";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type TileProps, lazyPart } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { timeLabel, today, useWeather } from "../shared";

function SunTile({ size, isSample }: TileProps) {
  const w = useWeather({ sample: isSample });
  const hour24 = useSettings((s) => s.clock24h);
  const now = useNow("minute").getTime();
  const day = today(w.data);
  const tomorrow = day ? w.data.daily[w.data.daily.indexOf(day) + 1] : undefined;
  const rise = day?.sunrise ?? 0;
  const set = day?.sunset ?? 0;
  const up = now >= rise && now <= set;
  const frac = up && set > rise ? (now - rise) / (set - rise) : now < rise ? 0 : 1;
  const nextRise = now > set && tomorrow ? tomorrow.sunrise : rise;
  const small = Math.max(9, Math.round(size * 0.2));
  const arcH = Math.round(size * 0.46);
  const daylight = set > rise ? Math.round((set - rise) / 60_000) : 0;

  // Sun position on a half-ellipse, in % of the arc box.
  const angle = Math.PI * (1 - frac);
  const px = 50 + 46 * Math.cos(angle);
  const py = 92 - 80 * Math.sin(angle);
  const dot = Math.max(5, Math.round(size * 0.15));

  return (
    <TileFrame className="flex-col justify-center gap-[3px] px-[calc(var(--tile-h)*0.18)]" title={`Sunrise ${timeLabel(rise, w.data.tz, hour24)} · Sunset ${timeLabel(set, w.data.tz, hour24)} · ${Math.floor(daylight / 60)}h ${daylight % 60}m daylight`}>
      <div className="relative w-full" style={{ height: arcH }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <path d="M 4 92 A 46 80 0 0 1 96 92" fill="none" stroke="var(--g-track)" strokeWidth="1.6" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {up && <path d={`M 4 92 A 46 80 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)}`} fill="none" stroke="#f5b324" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          <line x1="0" x2="100" y1="92" y2="92" stroke="var(--g-tile-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          className="absolute rounded-full"
          style={{ left: `${px}%`, top: `${py}%`, width: dot, height: dot, transform: "translate(-50%, -50%)", background: up ? "#f5b324" : "var(--g-faint)", boxShadow: up ? "0 0 8px rgba(245,179,36,0.65)" : "none" }}
        />
      </div>
      <div className="flex w-full justify-between leading-none tabular-nums" style={{ fontSize: small }}>
        <span className={up || now < rise ? "text-fg" : "text-dim"}>↑ {timeLabel(now > set ? nextRise : rise, w.data.tz, hour24)}</span>
        <span className={up ? "text-fg" : "text-dim"}>↓ {timeLabel(set, w.data.tz, hour24)}</span>
      </div>
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget({
  id: "weather.sun",
  name: "Sunrise & Sunset",
  category: "Weather",
  description: "The sun's position on a curve from sunrise to sunset today.",
  keywords: ["sun", "sunrise", "sunset", "daylight", "dawn", "dusk"],
  icon: Sunrise,
  size: "l",
  Tile: SunTile,
  Card: lazyPart(() => import("../WeatherCard").then((m) => m.WeatherCard)),
  cardSize: { width: 340 },
});
