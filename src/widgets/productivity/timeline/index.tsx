import { GanttChart } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import type { TimelineConfig } from "./data";
import { TimelineTile } from "./TimelineTile";

export default defineWidget<TimelineConfig>({
  id: "productivity.timeline",
  name: "Day Timeline",
  category: "Productivity",
  description: "Today on one strip: app time by category, focus, meetings, daylight.",
  keywords: ["day", "timeline", "schedule", "sunrise", "sunset", "screen time", "focus"],
  icon: GanttChart,
  size: "xl",
  Tile: TimelineTile,
  Card: lazyPart(() => import("./TimelineCard").then((m) => m.TimelineCard)),
  cardSize: { width: 420, height: 620 },
  defaultConfig: { lat: null, lon: null, place: "" },
});
