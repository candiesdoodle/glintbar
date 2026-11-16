import { CalendarDays } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ProgressTile } from "../shared/ProgressTile";
import { daysInMonth, monthProgress } from "../shared/progress";

function MonthTile({ size }: TileProps) {
  const now = useNow("minute");
  const total = daysInMonth(now.getFullYear(), now.getMonth());
  const label = now.toLocaleDateString(undefined, { month: "short" });
  const left = total - now.getDate();
  return (
    <ProgressTile
      size={size}
      label={label}
      fraction={monthProgress(now)}
      title={`Day ${now.getDate()} of ${total} · ${left === 0 ? "final day" : left === 1 ? "1 day to go" : `${left} days to go`}`}
    />
  );
}

export default defineWidget({
  id: "system.month-progress",
  name: "Month Progress",
  category: "System",
  description: "A bar that fills up as the days of this month pass.",
  keywords: ["month", "progress", "days left", "calendar"],
  icon: CalendarDays,
  size: "m",
  Tile: MonthTile,
});
