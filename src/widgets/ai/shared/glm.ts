/**
 * GLM Coding Plan (Z.ai, or Zhipu BigModel) limits with a pasted key. The quota endpoint is the
 * one Z.ai's own usage plugin reads: /api/monitor/usage/quota/limit, key in the Authorization header.
 */
import { getStored, setStored } from "../../../core/store";
import { httpJson, HttpError } from "../../../core/http";
import { secretRef } from "../../../core/secrets";
import type { AiLimit, ToolReading } from "./types";

export type GlmRegion = "zai" | "bigmodel";
export const GLM_REGION_KEY = "ai.glm.region";
export const GLM_SECRET = "ai.glm.apiKey";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function glmUrl(region: GlmRegion): string {
  return region === "bigmodel"
    ? "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
    : "https://api.z.ai/api/monitor/usage/quota/limit";
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function time(v: unknown): number | null {
  const n = num(v);
  if (n !== undefined && n > 0) return n < 1e11 ? n * 1000 : n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** Pure: the quota answer -> a reading. Throws when the answer has no limits at all. */
export function parseGlm(body: unknown, now: number): ToolReading {
  const root = (body ?? {}) as Record<string, unknown>;
  if (root.success === false || (typeof root.code === "number" && root.code !== 200 && root.code !== 0)) {
    throw new HttpError("unauthorized", 401, String(root.msg ?? root.message ?? ""));
  }
  const data = ((root.data as Record<string, unknown>) ?? root) as Record<string, unknown>;
  const raw = Array.isArray(data.limits) ? (data.limits as Array<Record<string, unknown>>) : [];
  const limits: AiLimit[] = [];
  for (const l of raw) {
    const type = String(l.type ?? "");
    const resetsAt = time(l.nextResetTime);
    let used = num(l.percentage);
    if (used === undefined) {
      const cur = num(l.currentValue);
      const total = num(l.usage) ?? num(l.total);
      if (cur !== undefined && total) used = (cur / total) * 100;
    }
    if (used === undefined) continue;
    used = Math.max(0, Math.min(100, used));
    if (/TIME/i.test(type)) {
      limits.push({ tool: "glm", window: "monthly_mcp", label: "MCP calls", usedPct: used, resetsAt, windowMs: 30 * DAY });
      continue;
    }
    const unit = num(l.unit);
    const n = num(l.number);
    const left = resetsAt ? resetsAt - now : undefined;
    const fiveHour = (unit === 3 && n === 5) || (left !== undefined && left <= 6 * HOUR);
    const weekly = !fiveHour && (unit === 6 || (left !== undefined && left <= 8 * DAY));
    if (fiveHour) limits.push({ tool: "glm", window: "session", label: "5-hour", usedPct: used, resetsAt, windowMs: 5 * HOUR });
    else if (weekly) limits.push({ tool: "glm", window: "weekly", label: "Week", usedPct: used, resetsAt, windowMs: 7 * DAY });
    else limits.push({ tool: "glm", window: "monthly", label: "Month", usedPct: used, resetsAt, windowMs: 30 * DAY });
  }
  if (!limits.length) throw new HttpError("bad_response", 200, "no limits in the answer");
  const order = ["session", "weekly", "monthly", "monthly_mcp"];
  limits.sort((a, b) => order.indexOf(a.window) - order.indexOf(b.window));
  const level = typeof data.level === "string" ? data.level : typeof data.planName === "string" ? data.planName : null;
  const plan = level ? `Coding Plan ${level[0].toUpperCase()}${level.slice(1)}` : "Coding Plan";
  return {
    tool: "glm",
    status: "ok",
    message: null,
    limits: limits.map((l) => ({ ...l, plan })),
    plan,
    billing: null,
    source: "live",
    asOf: now,
    fetchedAt: now,
    details: [],
  };
}

function headers(key: string): Record<string, string> {
  return { Authorization: key, "Accept-Language": "en-US,en" };
}

export async function fetchGlm(): Promise<ToolReading> {
  const region = getStored<GlmRegion>(GLM_REGION_KEY, "zai");
  const body = await httpJson<unknown>(glmUrl(region), { headers: headers(secretRef(GLM_SECRET)) });
  return parseGlm(body, Date.now());
}

/** Connect test: tries Z.ai, then BigModel, and remembers which one the key belongs to. */
export async function testGlmKey(key: string): Promise<void> {
  let lastError: unknown;
  for (const region of ["zai", "bigmodel"] as GlmRegion[]) {
    try {
      const body = await httpJson<unknown>(glmUrl(region), { headers: headers(key) });
      parseGlm(body, Date.now());
      setStored(GLM_REGION_KEY, region);
      return;
    } catch (e) {
      lastError = e;
      if (e instanceof HttpError && (e.kind === "offline" || e.kind === "timeout")) break;
    }
  }
  if (lastError instanceof HttpError && (lastError.kind === "unauthorized" || lastError.kind === "forbidden" || lastError.kind === "bad_response")) {
    throw new Error("GLM didn't accept this key. Make sure you copied all of it and that your Coding Plan is active.");
  }
  throw lastError;
}
