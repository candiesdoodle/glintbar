import { Hourglass } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { ScreenTimeTile } from "./ScreenTimeTile";
import type { ScreenTimeConfig } from "./types";

/**
 * Counted by Rust (services/productivity/screentime.rs) only while this tile or the Day Timeline
 * is on the dock, or "Count all the time" is on in the card.
 */
export default defineWidget<ScreenTimeConfig>({
  id: "productivity.screentime",
  name: "Screen Time",
  category: "Productivity",
  description: "Your PC time today by hour, with per-app totals per day and week.",
  keywords: ["usage", "apps", "focus", "time tracking", "digital wellbeing", "websites"],
  icon: Hourglass,
  size: "l",
  multiple: false,
  Tile: ScreenTimeTile,
  Card: lazyPart(() => import("./ScreenTimeCard").then((m) => m.ScreenTimeCard)),
  cardSize: { width: 380, height: 640 },
  defaultConfig: { pinned: null },
});
