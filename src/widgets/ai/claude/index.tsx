import { Sparkles } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { ClaudeCard, ClaudeUsageTile, claudeConnect } from "../shared/claude";

/** Claude's session (5-hour) limit on a ring, with when it resets. See shared/claude.tsx. */
export default defineWidget({
  id: "ai.claude",
  name: "Claude Usage",
  category: "AI",
  description: "Share of the current 5-hour Claude block used, and its refill time.",
  keywords: ["anthropic", "claude code", "limit", "session", "5-hour", "quota", "plan"],
  icon: Sparkles,
  size: "m",
  Tile: ClaudeUsageTile,
  Card: ClaudeCard,
  Connect: claudeConnect("ai.claude"),
  cardSize: { width: 340 },
});
