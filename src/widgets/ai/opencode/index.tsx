import { Code2 } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { OpenCodeCard, OpenCodeTile, openCodeConnect } from "../shared/opencode";

/** Tokens and cost of the current OpenCode session, read offline from its local history. */
export default defineWidget({
  id: "ai.opencode",
  name: "OpenCode Usage",
  category: "AI",
  description: "Tokens and cost of your current OpenCode session, read locally.",
  keywords: ["opencode", "tokens", "session", "cost", "cli"],
  icon: Code2,
  size: "m",
  Tile: OpenCodeTile,
  Card: OpenCodeCard,
  Connect: openCodeConnect("ai.opencode"),
  cardSize: { width: 340 },
});
