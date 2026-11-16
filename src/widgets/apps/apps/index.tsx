import { LayoutGrid } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import "./apps.css";
import { AppsTile } from "./AppsTile";
import { DEFAULT_APPS_CONFIG, type AppsConfig } from "./config";

/**
 * The taskbar's job: Start, pinned apps (seeded from the Windows taskbar), and every open
 * window as one icon per app, with previews, jump lists, groups, stacks and badges.
 * Rust: src-tauri/src/services/apps. The tile is as wide as its apps (`fit: "content"`).
 */
export default defineWidget<AppsConfig>({
  id: "apps.apps",
  name: "Apps",
  category: "Apps & Files",
  description: "Your taskbar in the dock: Start, pins and every open window.",
  keywords: ["taskbar", "start", "pinned", "windows", "launcher", "dock", "running", "programs"],
  icon: LayoutGrid,
  size: "xl",
  fit: "content",
  // The tile shows each app's own name on hover.
  hoverName: false,
  Tile: AppsTile,
  Card: lazyPart(() => import("./AppsCard").then((m) => m.AppsCard)),
  cardSize: { width: 340, height: 620 },
  defaultConfig: DEFAULT_APPS_CONFIG,
  multiple: false,
});
