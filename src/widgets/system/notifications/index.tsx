import { MessageSquareText } from "lucide-react";
import { call } from "../../../core/backend";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ActionTile } from "../shared/ActionTile";

const open = () => {
  call("system", "notifications_toggle").catch(() => {});
};

function NotificationsTile({ size, isSample }: TileProps) {
  return <ActionTile size={size} isSample={isSample} icon={MessageSquareText} title="Show or hide the notification panel" onAction={open} />;
}

export default defineWidget({
  id: "system.notifications",
  name: "Notifications",
  category: "System",
  description: "Opens or closes the Windows notification panel, like Win+N.",
  keywords: ["notification center", "action center", "alerts", "toasts", "calendar"],
  icon: MessageSquareText,
  size: "s",
  Tile: NotificationsTile,
});
