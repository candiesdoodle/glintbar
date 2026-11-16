import { Calendar } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { clockCardSize, ClockShellCard } from "../shared";

function DateTile({ size }: TileProps) {
  const now = useNow("minute");
  return (
    <TileFrame className="flex-col items-start justify-center leading-none" title={now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>
      <div className="truncate text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
        {now.toLocaleDateString(undefined, { weekday: "long" })}
        {size >= 44 && <span className="text-faint"> · {now.getFullYear()}</span>}
      </div>
      <div className="mt-[3px] truncate font-semibold" style={{ fontSize: Math.round(size * 0.38) }}>
        {now.toLocaleDateString(undefined, { day: "numeric", month: "long" })}
      </div>
    </TileFrame>
  );
}

function DateCard({ close }: CardProps) {
  return <ClockShellCard title="Date" icon={Calendar} close={close} />;
}

export default defineWidget({
  id: "clocks.date",
  name: "Date",
  category: "Clocks",
  description: "The current date, written out in full in big text.",
  keywords: ["date", "day", "month", "calendar", "weekday"],
  icon: Calendar,
  size: "l",
  Tile: DateTile,
  Card: DateCard,
  get cardSize() {
    return clockCardSize();
  },
});
