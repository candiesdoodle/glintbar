import { Bot, Code2, Gem, MousePointer2, Sparkles, Wallet, Zap, type LucideIcon } from "lucide-react";
import { siClaude, siCursor, siDeepseek, siGooglegemini, siOpencode, siX, type SimpleIcon } from "simple-icons";
import type { LimitTool, ToolId } from "./types";

export interface ToolMeta {
  id: ToolId;
  name: string;
  /** Brand glyph where simple-icons has one. */
  glyph?: SimpleIcon;
  /** Fallback / card header icon. */
  icon: LucideIcon;
  /** Where to look at the limits on the vendor's own site. */
  url?: string;
  /** Where the numbers come from, in plain words. */
  sourceNote: string;
}

export const TOOLS: Record<ToolId, ToolMeta> = {
  claude: {
    id: "claude",
    name: "Claude",
    glyph: siClaude,
    icon: Sparkles,
    url: "https://claude.ai/settings/usage",
    sourceNote: "Limits use the Claude Code login on this PC; token totals are counted from its local logs.",
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    icon: Bot,
    url: "https://chatgpt.com/codex/settings/usage",
    sourceNote: "Taken from the Codex CLI on this PC: its recent session files and its ChatGPT login.",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    glyph: siGooglegemini,
    icon: Gem,
    sourceNote: "Fetched from Google with the Gemini CLI login on this PC, using the same request as its /stats command.",
  },
  grok: {
    id: "grok",
    name: "Grok",
    glyph: siX,
    icon: Zap,
    url: "https://grok.com",
    sourceNote: "SuperGrok credits aren't readable by other apps yet, so these are sample figures.",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    glyph: siCursor,
    icon: MousePointer2,
    url: "https://cursor.com/dashboard",
    sourceNote: "Your plan name comes from the local Cursor app. Usage is sample data, as Cursor keeps it private for now.",
  },
  glm: {
    id: "glm",
    name: "GLM",
    icon: Zap,
    url: "https://z.ai/manage-apikey/subscription",
    sourceNote: "Fetched with the key you pasted, which goes to Z.ai or BigModel and nowhere else.",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    glyph: siDeepseek,
    icon: Wallet,
    url: "https://platform.deepseek.com/usage",
    sourceNote: "DeepSeek's API gives just the balance, so spend is estimated from drops in it while GlintBar is open.",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    glyph: siOpencode,
    icon: Code2,
    sourceNote: "Comes from OpenCode's local data on this PC, without going online.",
  },
};

export const LIMIT_TOOLS: LimitTool[] = ["claude", "chatgpt", "gemini", "glm", "grok", "cursor"];
