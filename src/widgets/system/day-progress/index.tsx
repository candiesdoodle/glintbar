import { Hourglass } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ProgressTile } from "../shared/ProgressTile";
import { dayProgress } from "../shared/progress";

function DayTile({ size }: TileProps) {
  const now = useNow("minute");
  const f = dayProgress(now);
  const left = Math.max(0, 24 * 60 - (now.getHours() * 60 + now.getMinutes()));
  const h = Math.floor(left / 60);
  const m = left % 60;
  return <ProgressTile size={size} label="Today" fraction={f} title={`${h}h ${m}m until midnight`} />;
}

export default defineWidget({
  id: "system.day-progress",
  name: "Day Progress",
  category: "System",
  description: "A bar that fills up as the hours of today pass.",
  keywords: ["day", "progress", "time left", "today", "hours"],
  icon: Hourglass,
  size: "m",
  Tile: DayTile,
});
