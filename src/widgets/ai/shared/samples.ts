/** Believable sample numbers for tiles that are not connected yet (and for the browser mock). */
import type { ClaudeLocal, DeepSeekBalance, LimitTool, OpenCodeUsage, ToolReading } from "./types";

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

/** Rounded to the minute so re-renders don't make sample times jitter. */
function minute(now: number): number {
  return Math.floor(now / MIN) * MIN;
}

function reading(tool: LimitTool, now: number, r: Partial<ToolReading>): ToolReading {
  const out: ToolReading = {
    tool,
    status: "ok",
    message: null,
    limits: [],
    plan: null,
    billing: null,
    source: "live",
    asOf: now,
    fetchedAt: now,
    details: [],
    ...r,
  };
  out.limits = out.limits.map((l) => ({ ...l, plan: out.plan, billing: out.billing }));
  return out;
}

export function sampleReading(tool: LimitTool, at = Date.now()): ToolReading {
  const now = minute(at);
  switch (tool) {
    case "claude":
      return reading(tool, now, {
        plan: "Max 5x",
        billing: { lastCharge: now - 16 * D, nextCharge: now + 14 * D, estimated: true, extraUsage: false },
        limits: [
          { tool, window: "session", label: "Session", usedPct: 37, resetsAt: now + 2 * H + 14 * MIN, windowMs: 5 * H },
          { tool, window: "weekly", label: "Week", usedPct: 22, resetsAt: now + 3 * D + 5 * H, windowMs: 7 * D },
        ],
      });
    case "chatgpt":
      return reading(tool, now, {
        plan: "Plus",
        billing: { lastCharge: now - 12 * D, nextCharge: now + 18 * D, estimated: false },
        source: "local",
        limits: [
          { tool, window: "session", label: "5-hour", usedPct: 18, resetsAt: now + 3 * H + 2 * MIN, windowMs: 5 * H },
          { tool, window: "weekly", label: "Week", usedPct: 41, resetsAt: now + 4 * D + 2 * H, windowMs: 7 * D },
        ],
      });
    case "gemini":
      return reading(tool, now, {
        plan: "Gemini Code Assist for individuals",
        limits: [
          { tool, window: "daily_pro", label: "Pro", usedPct: 46, resetsAt: now + 9 * H, windowMs: D },
          { tool, window: "daily_flash", label: "Flash", usedPct: 12, resetsAt: now + 9 * H, windowMs: D },
        ],
        details: [
          { label: "Pro model", value: "gemini-2.5-pro" },
          { label: "Flash model", value: "gemini-2.5-flash" },
        ],
      });
    case "grok":
      return reading(tool, now, {
        plan: "SuperGrok",
        billing: { lastCharge: now - 18 * D, nextCharge: now + 12 * D, estimated: false },
        limits: [{ tool, window: "monthly", label: "Credits", usedPct: 63, resetsAt: now + 12 * D, windowMs: 30 * D }],
        details: [{ label: "On-demand spend", value: "$0.00" }],
      });
    case "cursor":
      return reading(tool, now, {
        plan: "Pro",
        billing: { lastCharge: now - 13 * D, nextCharge: now + 17 * D, estimated: false },
        limits: [
          { tool, window: "monthly", label: "Included", usedPct: 58, resetsAt: now + 17 * D, windowMs: 30 * D },
          { tool, window: "monthly_auto", label: "Auto", usedPct: 41, resetsAt: now + 17 * D, windowMs: 30 * D },
          { tool, window: "monthly_api", label: "API", usedPct: 17, resetsAt: now + 17 * D, windowMs: 30 * D },
        ],
        details: [{ label: "On-demand spend", value: "$0.00 of $20" }],
      });
    case "glm":
      return reading(tool, now, {
        plan: "Coding Plan Pro",
        limits: [
          { tool, window: "session", label: "5-hour", usedPct: 28, resetsAt: now + H + 40 * MIN, windowMs: 5 * H },
          { tool, window: "weekly", label: "Week", usedPct: 35, resetsAt: now + 3 * D + 7 * H, windowMs: 7 * D },
          { tool, window: "monthly_mcp", label: "MCP calls", usedPct: 12, resetsAt: now + 18 * D, windowMs: 30 * D },
        ],
      });
  }
}

/** A deterministic "random" in [0, 1) for bucket i. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Work-hours shaped token series over the last `days`, one point per `step`. */
export function sampleSeries(now: number, step: number, days: number, scale: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const end = Math.floor(now / step) * step;
  for (let t = end - days * D; t <= end; t += step) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60;
    const weekday = d.getDay() !== 0 && d.getDay() !== 6;
    const work = h >= 9 && h <= 19 ? Math.sin(((h - 9) / 10) * Math.PI) : h >= 20 && h <= 23 ? 0.25 : 0;
    const r = noise(Math.floor(t / step));
    const v = work * (weekday ? 1 : 0.35) * (r > 0.3 ? r : 0) * scale;
    if (v > 0) out.push([t, Math.round(v)]);
  }
  return out;
}

export function sampleClaudeLocal(at = Date.now()): ClaudeLocal {
  const now = minute(at);
  const series = sampleSeries(now, 5 * MIN, 7, 60_000);
  const total = series.reduce((s, [, v]) => s + v, 0);
  return {
    found: true,
    lastActivity: now - 3 * MIN,
    pending: false,
    series,
    models: [
      { model: "claude-opus-4-5-20251101", tokens: Math.round(total * 0.71), output: Math.round(total * 0.05) },
      { model: "claude-sonnet-4-5-20250929", tokens: Math.round(total * 0.24), output: Math.round(total * 0.02) },
      { model: "claude-haiku-4-5-20251001", tokens: Math.round(total * 0.05), output: Math.round(total * 0.004) },
    ],
    week: { input: Math.round(total * 0.02), output: Math.round(total * 0.07), cacheWrite: Math.round(total * 0.91), cacheRead: total * 14, total },
    scannedAt: now,
  };
}

export function sampleOpenCode(at = Date.now()): OpenCodeUsage {
  const now = minute(at);
  const series = sampleSeries(now, H, 7, 90_000);
  const total = series.reduce((s, [, v]) => s + v, 0);
  const tok = (t: number) => ({ input: Math.round(t * 0.78), output: Math.round(t * 0.17), reasoning: Math.round(t * 0.05), cacheRead: t * 6, cacheWrite: Math.round(t * 0.1) });
  return {
    status: "ok",
    message: null,
    session: {
      id: "ses_sample",
      title: "Refactor the settings page",
      usage: { tokens: tok(182_400), total: 182_400, cost: 0.94, messages: 37 },
      model: "anthropic/claude-sonnet-4-5",
      started: now - 52 * MIN,
      updated: now - 2 * MIN,
    },
    week: { tokens: tok(total), total, cost: 11.62, messages: 412 },
    models: [
      { model: "anthropic/claude-sonnet-4-5", total: Math.round(total * 0.62), cost: 8.1 },
      { model: "openai/gpt-5.1-codex", total: Math.round(total * 0.27), cost: 3.04 },
      { model: "deepseek/deepseek-chat", total: Math.round(total * 0.11), cost: 0.48 },
    ],
    series,
    lastActivity: now - 2 * MIN,
    fetchedAt: now,
  };
}

export function sampleDeepSeek(at = Date.now()): { balance: DeepSeekBalance; today: number; week: number; perDay: number; daysLeft: number; days: Array<[number, number]> } {
  const now = minute(at);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days: Array<[number, number]> = [];
  for (let i = 6; i >= 0; i--) days.push([start.getTime() - i * D, Math.round((0.22 + noise(i) * 0.5) * 100) / 100]);
  const week = days.reduce((s, [, v]) => s + v, 0);
  return {
    balance: { available: true, currency: "USD", total: 18.42, granted: 0, toppedUp: 18.42, fetchedAt: now },
    today: days[days.length - 1][1],
    week: Math.round(week * 100) / 100,
    perDay: week / 7,
    daysLeft: 18.42 / (week / 7),
    days,
  };
}
