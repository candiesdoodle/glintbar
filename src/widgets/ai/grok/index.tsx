import { Zap } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { makeLimitCard, makeLimitTile } from "../shared/limitWidget";

const opts = { tool: "grok", widgetId: "ai.grok", layout: "ring", previewOnly: true } as const;

/**
 * Preview: xAI has no documented way for another app to read SuperGrok credits, so the numbers
 * are a labelled sample and the card says so in plain words.
 */
export default defineWidget({
  id: "ai.grok",
  name: "Grok Usage",
  category: "AI",
  description: "SuperGrok credit use per billing cycle (sample figures for now).",
  keywords: ["xai", "supergrok", "credits", "x premium", "limit"],
  icon: Zap,
  size: "m",
  Tile: makeLimitTile(opts),
  Card: makeLimitCard(opts),
  cardSize: { width: 340 },
});
