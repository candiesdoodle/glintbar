import { Camera } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { ScreenshotTile } from "./ScreenshotTile";
import { DEFAULT_SHOT, type ScreenshotConfig } from "./shared";

export default defineWidget<ScreenshotConfig>({
  id: "apps.screenshot",
  name: "Screenshot Capture",
  category: "Apps & Files",
  description: "Screenshot the whole screen, the active window or a selected area.",
  keywords: ["screenshot", "capture", "snip", "print screen", "screen grab", "clipboard"],
  icon: Camera,
  size: "l",
  Tile: ScreenshotTile,
  Card: lazyPart(() => import("./ScreenshotCard").then((m) => m.ScreenshotCard)),
  cardSize: { width: 330 },
  defaultConfig: DEFAULT_SHOT,
});
