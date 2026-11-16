/** Mirrors src-tauri/src/services/ai/model.rs (and the other ai/*.rs results). serde camelCase. */

/** Tools that have limit windows. */
export type LimitTool = "claude" | "chatgpt" | "gemini" | "grok" | "cursor" | "glm";
export type ToolId = LimitTool | "deepseek" | "opencode";

export type ReadingStatus = "ok" | "expired" | "signed_out" | "not_installed" | "unavailable" | "preview";

export interface Billing {
  /** Unix ms */
  lastCharge?: number | null;
  /** Unix ms */
  nextCharge?: number | null;
  /** Worked out (e.g. from the day the plan started), not reported by the vendor. */
  estimated: boolean;
  extraUsage?: boolean | null;
}

/** One limit window. The shared model every AI tile, card, chart and signal uses. */
export interface AiLimit {
  tool: ToolId;
  /** "session" | "weekly" | "weekly_opus" | "daily_pro" | "monthly" | ... */
  window: string;
  /** Short label: "Session", "Week", "5-hour", "Pro". */
  label: string;
  /** 0-100 */
  usedPct: number;
  /** Unix ms; null when the window has not started yet. */
  resetsAt: number | null;
  windowMs?: number | null;
  plan?: string | null;
  billing?: Billing | null;
}

export interface Detail {
  label: string;
  value: string;
}

export interface ToolReading {
  tool: ToolId;
  status: ReadingStatus;
  message?: string | null;
  limits: AiLimit[];
  plan?: string | null;
  billing?: Billing | null;
  source: "live" | "local" | "none";
  /** Unix ms the numbers describe. */
  asOf?: number | null;
  fetchedAt: number;
  details: Detail[];
}

/** ai.claude_local */
export interface ClaudeLocal {
  found: boolean;
  lastActivity: number | null;
  pending: boolean;
  /** [5-minute bucket start ms, tokens] */
  series: Array<[number, number]>;
  models: Array<{ model: string; tokens: number; output: number }>;
  week: { input: number; output: number; cacheWrite: number; cacheRead: number; total: number };
  scannedAt: number;
}

export interface OcTok {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface OcTotals {
  tokens: OcTok;
  total: number;
  cost: number;
  messages: number;
}

/** ai.opencode_usage */
export interface OpenCodeUsage {
  status: "ok" | "not_installed" | "unavailable";
  message?: string | null;
  session: { id: string; title: string | null; usage: OcTotals; model: string | null; started: number; updated: number } | null;
  week: OcTotals;
  models: Array<{ model: string; total: number; cost: number }>;
  /** [hour start ms, tokens] */
  series: Array<[number, number]>;
  lastActivity: number | null;
  fetchedAt: number;
}

/** DeepSeek /user/balance, normalised. */
export interface DeepSeekBalance {
  available: boolean;
  currency: string;
  total: number;
  granted: number;
  toppedUp: number;
  fetchedAt: number;
}
