import { AppWindow } from "lucide-react";
import { call } from "../../../core/backend";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ActionTile } from "../shared/ActionTile";

const toggle = () => {
  call("system", "show_desktop").catch(() => {});
};

function ShowDesktopTile({ size, isSample }: TileProps) {
  return <ActionTile size={size} isSample={isSample} icon={AppWindow} title="Minimise all windows · click again to restore them" onAction={toggle} />;
}

export default defineWidget({
  id: "system.show-desktop",
  name: "Show Desktop",
  category: "System",
  description: "Minimises every window to show the desktop; click again to restore.",
  keywords: ["desktop", "minimize", "peek", "windows", "win+d"],
  icon: AppWindow,
  size: "s",
  Tile: ShowDesktopTile,
});
