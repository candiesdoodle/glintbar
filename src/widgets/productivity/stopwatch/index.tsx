import { Watch } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { StopwatchTile } from "./StopwatchTile";

export default defineWidget({
  id: "productivity.stopwatch",
  name: "Stopwatch",
  category: "Productivity",
  description: "Run, pause and record laps from the dock; the card lists them all.",
  keywords: ["lap", "chronometer", "time", "split"],
  icon: Watch,
  size: "l",
  multiple: false,
  Tile: StopwatchTile,
  Card: lazyPart(() => import("./StopwatchCard").then((m) => m.StopwatchCard)),
  cardSize: { width: 320 },
});
