import { CalendarRange } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, Stat, TileFrame } from "../../../ui";
import { fs } from "../shared/format";
import { dayOfYear, daysInMonth, daysInYear, pctText, yearProgress } from "../shared/progress";

const WEEKS = 52;
const COLS = 13;
const ROWS = 4;

/** 52 week dots (13 x 4): passed weeks filled, this week half, the rest empty. */
function WeekGrid({ fraction, pitch }: { fraction: number; pitch: number }) {
  const done = fraction * WEEKS;
  const r = pitch * 0.34;
  const dots = [];
  for (let i = 0; i < WEEKS; i++) {
    const x = (i % COLS) * pitch + pitch / 2;
    const y = Math.floor(i / COLS) * pitch + pitch / 2;
    const passed = i + 1 <= done;
    const current = !passed && i < done;
    dots.push(
      <circle
        key={i}
        cx={x}
        cy={y}
        r={r}
        fill={passed ? "var(--g-accent)" : current ? "var(--g-accent)" : "var(--g-track)"}
        fillOpacity={current ? 0.45 : 1}
      />,
    );
  }
  return (
    <svg width={COLS * pitch} height={ROWS * pitch} viewBox={`0 0 ${COLS * pitch} ${ROWS * pitch}`} className="shrink-0" aria-hidden>
      {dots}
    </svg>
  );
}

function YearTile({ size }: TileProps) {
  const now = useNow("minute");
  const f = yearProgress(now);
  const pitch = (size * 0.62) / ROWS;
  const total = daysInYear(now.getFullYear());
  const day = dayOfYear(now);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={`Day ${day} of ${total} in ${now.getFullYear()} · ${total - day} remaining`}>
      <WeekGrid fraction={f} pitch={pitch} />
      <div className="min-w-0 leading-none">
        <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.3) }}>
          {pctText(f)}
        </div>
        <div className="mt-[3px] text-dim tabular-nums" style={{ fontSize: fs(size, 0.2, 8) }}>
          {now.getFullYear()}
        </div>
      </div>
    </TileFrame>
  );
}

function YearCard(_: CardProps) {
  const now = useNow("minute");
  const year = now.getFullYear();
  const total = daysInYear(year);
  const day = dayOfYear(now);
  const months = Array.from({ length: 12 }, (_, m) => m);
  const label = (m: number) => new Date(year, m, 1).toLocaleDateString(undefined, { month: "short" });
  return (
    <CardFrame title={String(year)} subtitle={`${pctText(yearProgress(now))} of ${year} has passed`} icon={CalendarRange}>
      <div className="flex flex-col gap-[5px]">
        {months.map((m) => {
          const days = daysInMonth(year, m);
          return (
            <div key={m} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10.5px] text-faint">{label(m)}</span>
              <div className="flex gap-[2px]">
                {Array.from({ length: days }, (_, d) => {
                  const isToday = m === now.getMonth() && d + 1 === now.getDate();
                  const passed = m < now.getMonth() || (m === now.getMonth() && d + 1 < now.getDate());
                  return (
                    <span
                      key={d}
                      className={"block h-[5px] w-[5px] rounded-full " + (isToday ? "bg-accent ring-2 ring-accent/40" : passed ? "bg-accent" : "bg-track")}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Day" value={day} sub={`of ${total}`} />
        <Stat label="Days left" value={total - day} />
        <Stat label="Weeks left" value={Math.floor((total - day) / 7)} />
      </div>
    </CardFrame>
  );
}

export default defineWidget({
  id: "system.year-progress",
  name: "Year Progress",
  category: "System",
  description: "52 dots, one per week, that fill in as this year goes by.",
  keywords: ["year", "progress", "weeks", "calendar", "dots"],
  icon: CalendarRange,
  size: "l",
  Tile: YearTile,
  Card: YearCard,
  cardSize: { width: 300 },
});
