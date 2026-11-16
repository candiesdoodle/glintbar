import { Target } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { PomodoroTile } from "./PomodoroTile";

export default defineWidget({
  id: "productivity.pomodoro",
  name: "Pomodoro",
  category: "Productivity",
  description: "Focus sessions with breaks, started or skipped from the tile.",
  keywords: ["focus", "tomato", "timer", "break", "deep work"],
  icon: Target,
  size: "l",
  multiple: false,
  Tile: PomodoroTile,
  Card: lazyPart(() => import("./PomodoroCard").then((m) => m.PomodoroCard)),
  cardSize: { width: 360, height: 560 },
});
