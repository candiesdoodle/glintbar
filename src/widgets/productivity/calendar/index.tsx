import { CalendarDays } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { CalendarTile } from "./CalendarTile";

export default defineWidget({
  id: "productivity.calendar",
  name: "Calendar",
  category: "Productivity",
  description: "Time to your next event (iCloud, Google, Outlook), renewals and payouts.",
  keywords: ["events", "meetings", "agenda", "ical", "ics", "google calendar", "outlook", "icloud", "schedule"],
  icon: CalendarDays,
  size: "l",
  multiple: false,
  Tile: CalendarTile,
  Card: lazyPart(() => import("./CalendarCard").then((m) => m.CalendarCard)),
  cardSize: { width: 380, height: 620 },
});
