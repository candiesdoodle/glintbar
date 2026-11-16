import { HardDrive } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import type { StorageConfig } from "./shared";
import { StorageTile } from "./StorageTile";

export default defineWidget<StorageConfig>({
  id: "apps.storage",
  name: "Storage",
  category: "Apps & Files",
  description: "How full a drive is, and when it fills up at the current rate.",
  keywords: ["disk", "drive", "space", "ssd", "usb", "free", "capacity"],
  icon: HardDrive,
  size: "m",
  Tile: StorageTile,
  Card: lazyPart(() => import("./StorageCard").then((m) => m.StorageCard)),
  cardSize: { width: 340, height: 560 },
  defaultConfig: { root: "" },
});
