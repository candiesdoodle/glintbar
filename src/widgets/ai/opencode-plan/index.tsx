import { Code2 } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { OpenCodeCard, OpenCodePlanTile, openCodeConnect } from "../shared/opencode";

/** OpenCode tokens this session and this week, and the top model. */
export default defineWidget({
  id: "ai.opencode-plan",
  name: "OpenCode Plan Usage",
  category: "AI",
  description: "Session and 7-day OpenCode token totals, and the model you use most.",
  keywords: ["opencode", "tokens", "week", "model", "cli"],
  icon: Code2,
  size: "l",
  Tile: OpenCodePlanTile,
  Card: OpenCodeCard,
  Connect: openCodeConnect("ai.opencode-plan"),
  cardSize: { width: 340 },
});
