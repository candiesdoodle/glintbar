import { AppWindow } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import type { AppEntry } from "../types";
import { ShortcutTile } from "./ShortcutTile";

export interface ShortcutConfig extends Record<string, unknown> {
  entry: AppEntry | null;
}

/** Any app, folder or file as a widget of its own (add as many as you like). */
export default defineWidget<ShortcutConfig>({
  id: "apps.shortcut",
  name: "App or Folder",
  category: "Apps & Files",
  description: "One app, file or folder as a tile; folders open as a stack.",
  keywords: ["shortcut", "app", "folder", "launcher", "pin", "file", "stack"],
  icon: AppWindow,
  size: "s",
  Tile: ShortcutTile,
  Card: lazyPart(() => import("./ShortcutCard").then((m) => m.ShortcutCard)),
  cardSize: { width: 320, height: 460 },
  defaultConfig: { entry: null },
  multiple: true,
});
