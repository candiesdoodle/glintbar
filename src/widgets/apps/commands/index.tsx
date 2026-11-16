import { Command } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { CommandsTile } from "./CommandsTile";

export default defineWidget({
  id: "apps.commands",
  name: "Commands",
  category: "Apps & Files",
  description: "Type to start an app or run an action such as Lock or Sleep.",
  keywords: ["launcher", "run", "command", "palette", "type", "open app", "quick"],
  icon: Command,
  size: "l",
  Tile: CommandsTile,
  Card: lazyPart(() => import("./CommandsCard").then((m) => m.CommandsCard)),
  cardSize: { width: 320, height: 520 },
});
