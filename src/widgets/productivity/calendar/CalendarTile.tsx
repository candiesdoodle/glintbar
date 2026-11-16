import { useSettings } from "../../../core/store";
import { timeOfDay } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { untilText } from "../shared/time";
import { sampleItems } from "./sample";
import { KIND_COLORS } from "./sources";
import { nextItem, useCalendarItems } from "./store";

export function CalendarTile({ size, isSample }: TileProps) {
  const now = useNow("minute");
  const hour24 = useSettings((s) => s.clock24h);
  const { items } = useCalendarItems();
  // Sample events only in the widget picker; an empty calendar shows today's date and "No events".
  const sample = isSample;
  const list = sample ? sampleItems(now.getTime()) : items;
  const next = nextItem(list, now.getTime());
  const page = Math.round(size * 0.72);
  const big = Math.max(11, Math.round(size * 0.28));
  const small = Math.max(9, Math.round(size * 0.22));
  const t = now.getTime();

  let when = "";
  if (next) {
    if (next.allDay) {
      const days = Math.round((new Date(next.start).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
      when = days <= 0 ? "Today" : days === 1 ? "Tomorrow" : new Date(next.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    } else if (next.start <= t) when = next.end ? `Now · until ${timeOfDay(new Date(next.end), { hour24 })}` : "Now";
    else if (next.start - t < 3 * 3600_000) when = untilText(next.start, t);
    else if (new Date(next.start).toDateString() === now.toDateString()) when = timeOfDay(new Date(next.start), { hour24 });
    else when = new Date(next.start).toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", hour12: !hour24 });
  }
  const urgent = next && !next.allDay && next.start - t < 15 * 60_000;

  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={next ? `${next.title} - ${when}` : "Calendar"}>
      {sample && <TileSampleBadge />}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-[22%] bg-card leading-none shadow-sm" style={{ width: page, height: page }}>
        <div className="bg-bad py-[2px] text-center font-semibold text-white uppercase" style={{ fontSize: Math.max(7, Math.round(page * 0.2)) }}>
          {now.toLocaleDateString(undefined, { weekday: "short" })}
        </div>
        <div className="grid flex-1 place-items-center font-semibold tabular-nums text-fg" style={{ fontSize: Math.round(page * 0.46) }}>
          {now.getDate()}
        </div>
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={"flex items-center gap-1" + (sample ? " pr-[30px]" : "")} style={{ fontSize: small }}>
          {next && <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: next.color ?? KIND_COLORS[next.kind] }} />}
          <span className={urgent ? "truncate font-medium text-accent" : "truncate text-dim"}>{next ? when : "No events"}</span>
        </div>
        <div className="truncate font-medium" style={{ fontSize: big }}>
          {next ? next.title : now.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
        </div>
      </div>
    </TileFrame>
  );
}
