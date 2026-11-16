/** Browser-preview data for the AI slice (mirrors what src-tauri/src/services/ai returns). */
import { mockService } from "../../core/mock";
import { sampleClaudeLocal, sampleOpenCode, sampleReading } from "./shared/samples";
import type { ToolReading } from "./shared/types";

function live(tool: Parameters<typeof sampleReading>[0]): ToolReading {
  // Slightly different from the picker's sample numbers, so a connected tile looks like "yours".
  const r = sampleReading(tool);
  const bump = (p: number, by: number) => Math.min(100, Math.max(0, Math.round(p + by)));
  return { ...r, limits: r.limits.map((l, i) => ({ ...l, usedPct: bump(l.usedPct, i === 0 ? 9 : 4) })) };
}

/** Browser preview only: localStorage "glintbar.mock.aiStatus" = "expired" | "signed_out" | "offline" forces a state. */
function forced(tool: ToolReading["tool"]): ToolReading | null {
  let s: string | null = null;
  try {
    s = localStorage.getItem("glintbar.mock.aiStatus");
  } catch {
    /* no storage */
  }
  if (!s) return null;
  if (s === "offline") throw "offline: could not connect (mock)";
  const messages: Record<string, string> = {
    expired: "The Claude Code login is out of date. Start Claude Code once to renew it; GlintBar uses the new one on its next refresh.",
    signed_out: "No login found. Log in with the tool itself, then click Check again.",
  };
  return { tool, status: s as ToolReading["status"], message: messages[s] ?? s, limits: [], plan: null, billing: null, source: "none", asOf: null, fetchedAt: Date.now(), details: [] };
}

mockService("ai", {
  claude_usage: () => forced("claude") ?? live("claude"),
  claude_local: () => sampleClaudeLocal(),
  codex_usage: () => forced("chatgpt") ?? live("chatgpt"),
  gemini_usage: () => forced("gemini") ?? live("gemini"),
  opencode_usage: () => sampleOpenCode(),
  cursor_usage: (): ToolReading => ({
    tool: "cursor",
    status: "preview",
    message: "Logged in. Cursor keeps usage figures private from other apps for now, so this tile shows a sample.",
    limits: [],
    plan: "Pro",
    billing: null,
    source: "local",
    asOf: null,
    fetchedAt: Date.now(),
    details: [{ label: "Subscription", value: "Active" }],
  }),
  grok_usage: (): ToolReading => ({
    tool: "grok",
    status: "unavailable",
    message: "SuperGrok credits can't be read yet because xAI offers other apps no way to see them. Until that changes, the tile shows sample figures.",
    limits: [],
    plan: null,
    billing: null,
    source: "none",
    asOf: null,
    fetchedAt: Date.now(),
    details: [],
  }),
});
