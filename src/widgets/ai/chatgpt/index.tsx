import { Bot } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { makeLocalConnect } from "../shared/connect";
import { makeLimitCard, makeLimitTile } from "../shared/limitWidget";

const ID = "ai.chatgpt";
const opts = { tool: "chatgpt", widgetId: ID, autoConnect: true } as const;

/** Codex 5-hour and weekly windows from the Codex CLI's own sessions and sign-in. */
export default defineWidget({
  id: ID,
  name: "ChatGPT Usage",
  category: "AI",
  description: "Codex use on your ChatGPT subscription per 5-hour block and week.",
  keywords: ["openai", "codex", "gpt", "limit", "weekly", "5-hour", "quota", "plan"],
  icon: Bot,
  size: "l",
  Tile: makeLimitTile(opts),
  Card: makeLimitCard(opts),
  Connect: makeLocalConnect(
    ID,
    "chatgpt",
    [
      "In a terminal, add the Codex CLI with npm install -g @openai/codex",
      "Type codex login, then pick the Sign in with ChatGPT option (Plus, Pro, Business…).",
      "Back here, use Check again. Real numbers replace the sample once GlintBar finds the login.",
      "Only the Codex allowance is shown. Chat limits inside the ChatGPT app aren't exposed to other software.",
    ],
    "OpenAI",
  ),
  cardSize: { width: 340 },
});
