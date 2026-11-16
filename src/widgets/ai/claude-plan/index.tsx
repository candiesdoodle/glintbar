import { Sparkles } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { ClaudeCard, ClaudePlanTile, claudeConnect } from "../shared/claude";

/** Session and weekly Claude limits side by side, plus the most-used model. */
export default defineWidget({
  id: "ai.claude-plan",
  name: "Claude Plan Usage",
  category: "AI",
  description: "Claude 5-hour block and weekly use, refill times and top model.",
  keywords: ["anthropic", "claude code", "limit", "weekly", "session", "model", "tokens", "plan"],
  icon: Sparkles,
  size: "xl",
  Tile: ClaudePlanTile,
  Card: ClaudeCard,
  Connect: claudeConnect("ai.claude-plan"),
  cardSize: { width: 340 },
});
