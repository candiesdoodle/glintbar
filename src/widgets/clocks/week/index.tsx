import { CalendarRange } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { cx, TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { condition } from "../../weather/conditions";
import { temp, useWeather } from "../../weather/shared";
import { clockCardSize, ClockShellCard } from "../shared";

function WeekTile({ size, isSample }: TileProps) {
  const now = useNow("minute");
  const w = useWeather({ sample: isSample });
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const cur = w.data.current;
  const c = condition(cur.code, cur.isDay);
  const Icon = c.icon;
  const small = Math.max(8, Math.round(size * 0.18));
  const big = Math.max(10, Math.round(size * 0.3));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.08)] px-[calc(var(--tile-h)*0.12)]" title={now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
      <div className="flex min-w-0 flex-1 justify-between">
        {days.map((d) => {
          const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
          const past = d < now && !isToday;
          return (
            <div
              key={d.getTime()}
              className={cx("flex flex-col items-center justify-center rounded-[calc(var(--tile-h)*0.16)] leading-none tabular-nums", isToday ? "bg-accent text-on-accent" : past ? "text-faint" : "text-fg")}
              style={{ width: Math.round(size * 0.44), height: Math.round(size * 0.78) }}
            >
              <span className={isToday ? "opacity-85" : "text-dim"} style={{ fontSize: small }}>
                {d.toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
              <span className="mt-[2px] font-semibold" style={{ fontSize: big }}>
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 flex-col items-center justify-center leading-none" title={c.label}>
        <Icon size={Math.round(size * 0.34)} style={{ color: c.tone }} />
        <span className="mt-[2px] font-semibold tabular-nums" style={{ fontSize: Math.max(10, Math.round(size * 0.24)) }}>
          {temp(cur.temp, w.units)}
        </span>
      </div>
      {w.isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function WeekCard({ close }: CardProps) {
  return <ClockShellCard title="7 Days" icon={CalendarRange} close={close} />;
}

export default defineWidget({
  id: "clocks.week",
  name: "7 Days",
  category: "Clocks",
  description: "Monday to Sunday with today highlighted, plus the current temperature.",
  keywords: ["week", "days", "calendar", "date", "weather", "temperature"],
  icon: CalendarRange,
  size: "xl",
  Tile: WeekTile,
  Card: WeekCard,
  get cardSize() {
    return clockCardSize();
  },
});
