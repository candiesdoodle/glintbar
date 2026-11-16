import { Search } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import type { Engine } from "./logic";
import { SearchTile } from "./SearchTile";

export interface SearchConfig extends Record<string, unknown> {
  engine: Engine;
  history: string[];
}

export default defineWidget<SearchConfig>({
  id: "apps.search",
  name: "Search",
  category: "Apps & Files",
  description: "One box for web searches, website addresses and folder paths on this PC.",
  keywords: ["search", "web", "google", "bing", "folder", "path", "open", "url"],
  icon: Search,
  size: "l",
  Tile: SearchTile,
  Card: lazyPart(() => import("./SearchCard").then((m) => m.SearchCard)),
  cardSize: { width: 320 },
  defaultConfig: { engine: "google", history: [] },
});
