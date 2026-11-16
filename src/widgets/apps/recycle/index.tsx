import { Trash2 } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { RecycleTile } from "./RecycleTile";

export default defineWidget({
  id: "apps.recycle",
  name: "Recycle Bin",
  category: "Apps & Files",
  description: "Recycle Bin size and item count. Drop files on it or empty it.",
  keywords: ["trash", "bin", "delete", "empty", "recycle"],
  icon: Trash2,
  size: "s",
  Tile: RecycleTile,
  Card: lazyPart(() => import("./RecycleCard").then((m) => m.RecycleCard)),
  cardSize: { width: 300 },
});
