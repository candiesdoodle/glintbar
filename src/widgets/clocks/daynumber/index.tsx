import { CalendarDays } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { clockCardSize, ClockShellCard } from "../shared";

function DayNumberTile({ size }: TileProps) {
  const now = useNow("minute");
  const band = Math.round(size * 0.3);
  return (
    <TileFrame padded={false} title={now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
      <div className="flex h-full w-full flex-col">
      <div className="grid shrink-0 place-items-center bg-bad font-bold tracking-wider text-white uppercase" style={{ height: band, fontSize: Math.max(7, Math.round(size * 0.18)) }}>
        {now.toLocaleDateString(undefined, { month: "short" }).replace(".", "")}
      </div>
      <div className="grid flex-1 place-items-center font-semibold tabular-nums leading-none" style={{ fontSize: Math.round(size * 0.48) }}>
        {now.getDate()}
      </div>
      </div>
    </TileFrame>
  );
}

function DayNumberCard({ close }: CardProps) {
  return <ClockShellCard title="Day Number" icon={CalendarDays} close={close} />;
}

export default defineWidget({
  id: "clocks.daynumber",
  name: "Day Number",
  category: "Clocks",
  description: "The day of the month on a page styled like a desk calendar.",
  keywords: ["date", "day", "calendar", "page", "month"],
  icon: CalendarDays,
  size: "s",
  Tile: DayNumberTile,
  Card: DayNumberCard,
  get cardSize() {
    return clockCardSize();
  },
});
