import { History } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { RecentTile } from "./RecentTile";
import type { RecentConfig } from "./shared";

export default defineWidget<RecentConfig>({
  id: "apps.recent",
  name: "Recently Opened",
  category: "Apps & Files",
  description: "Your recently used files and apps, one click to reopen.",
  keywords: ["recent", "files", "documents", "history", "last opened", "jump"],
  icon: History,
  size: "l",
  Tile: RecentTile,
  Card: lazyPart(() => import("./RecentCard").then((m) => m.RecentCard)),
  cardSize: { width: 340, height: 480 },
  defaultConfig: { tab: "files" },
});
