import { Timer } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { TimerTile } from "./TimerTile";

export default defineWidget({
  id: "productivity.timer",
  name: "Timer",
  category: "Productivity",
  description: "Counts down a length you pick; saved lengths start with a single click.",
  keywords: ["countdown", "kitchen timer", "alarm", "minutes"],
  icon: Timer,
  size: "m",
  multiple: false,
  Tile: TimerTile,
  Card: lazyPart(() => import("./TimerCard").then((m) => m.TimerCard)),
  cardSize: { width: 320 },
});
