import { MousePointer2 } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { makeLocalConnect } from "../shared/connect";
import { makeLimitCard, makeLimitTile } from "../shared/limitWidget";

const ID = "ai.cursor";
const opts = { tool: "cursor", widgetId: ID, layout: "ring", previewOnly: true, autoConnect: true } as const;

/** Preview: the plan and sign-in come from the Cursor app; usage numbers stay a labelled sample. */
export default defineWidget({
  id: ID,
  name: "Cursor Usage",
  category: "AI",
  description: "Preview: your Cursor plan, with sample spend and token figures.",
  keywords: ["cursor", "ide", "auto", "api", "on-demand", "spend", "limit"],
  icon: MousePointer2,
  size: "m",
  Tile: makeLimitTile(opts),
  Card: makeLimitCard(opts),
  Connect: makeLocalConnect(
    ID,
    "cursor",
    ["Start Cursor and log in to your account.", "Use Check again to pull in your plan name. Usage figures remain a sample because Cursor doesn't expose them to other apps."],
    "Cursor",
  ),
  cardSize: { width: 340 },
});
