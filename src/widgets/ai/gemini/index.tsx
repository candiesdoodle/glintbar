import { Gem } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { makeLocalConnect } from "../shared/connect";
import { makeLimitCard, makeLimitTile } from "../shared/limitWidget";

const ID = "ai.gemini";
const opts = { tool: "gemini", widgetId: ID, autoConnect: true } as const;

/** Gemini CLI daily quota for Pro and Flash (the tightest model of each), with reset times. */
export default defineWidget({
  id: ID,
  name: "Gemini Usage",
  category: "AI",
  description: "Gemini CLI daily use for Pro and Flash, and when each refills.",
  keywords: ["google", "gemini cli", "antigravity", "quota", "pro", "flash", "limit"],
  icon: Gem,
  size: "l",
  Tile: makeLimitTile(opts),
  Card: makeLimitCard(opts),
  Connect: makeLocalConnect(
    ID,
    "gemini",
    [
      "Set up the Gemini CLI, then start it by typing gemini in a terminal.",
      "Pick Login with Google and follow its prompts to the end.",
      "Back here, use Check again. Real numbers replace the sample once GlintBar finds the login; while the CLI isn't running, the most recent reading is kept.",
    ],
    "Google",
  ),
  cardSize: { width: 340 },
});
