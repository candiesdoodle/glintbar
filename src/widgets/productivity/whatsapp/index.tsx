import { MessageCircle } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { WhatsAppTile } from "./WhatsAppTile";

export default defineWidget({
  id: "productivity.whatsapp",
  name: "WhatsApp",
  category: "Productivity",
  description: "Unread WhatsApp count and last sender, from Windows notifications.",
  keywords: ["messages", "chat", "unread", "notifications"],
  icon: MessageCircle,
  size: "m",
  multiple: false,
  Tile: WhatsAppTile,
  Card: lazyPart(() => import("./WhatsAppCard").then((m) => m.WhatsAppCard)),
  cardSize: { width: 320 },
});
