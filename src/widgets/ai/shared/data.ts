/**
 * One Source per tool (see sources.ts), the hooks tiles and cards use, and auto-detection of
 * local sign-ins. Readings feed the chart history and the calendar/automation signals.
 */
import { useEffect, useMemo } from "react";
import { call } from "../../../core/backend";
import { setConnected, useIsConnected } from "../../../core/connections";
import { fetchDeepSeek, recordBalance } from "./deepseek";
import { fetchGlm } from "./glm";
import { recordLimits } from "./history";
import { sampleClaudeLocal, sampleOpenCode, sampleReading } from "./samples";
import { publishReading } from "./signals";
import { Source, useSource, type SourceOptions, type SourceState } from "./sources";
import type { ClaudeLocal, DeepSeekBalance, LimitTool, OpenCodeUsage, ToolReading } from "./types";

const MIN = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, Source<any>>();

function lazy<T>(key: string, make: () => SourceOptions<T>): Source<T> {
  let s = registry.get(key) as Source<T> | undefined;
  if (!s) {
    s = new Source<T>(make());
    registry.set(key, s);
  }
  return s;
}

function onReading(r: ToolReading) {
  if (r.status === "ok") recordLimits(r.limits);
  publishReading(r);
}

function claudeActive(): boolean {
  const d = claudeLocalSource().getState().data;
  return Boolean(d?.lastActivity && Date.now() - d.lastActivity < 10 * MIN);
}

const FETCH: Record<LimitTool, () => Promise<ToolReading>> = {
  claude: () => call<ToolReading>("ai", "claude_usage"),
  chatgpt: () => call<ToolReading>("ai", "codex_usage"),
  gemini: () => call<ToolReading>("ai", "gemini_usage"),
  grok: () => call<ToolReading>("ai", "grok_usage"),
  cursor: () => call<ToolReading>("ai", "cursor_usage"),
  glm: fetchGlm,
};

const EVERY: Record<LimitTool, (s: SourceState<ToolReading>) => number> = {
  // Every 15 minutes, every 2 while Claude Code is being used (its history files change).
  claude: (s) => (s.error ? 15 * MIN : claudeActive() ? 2 * MIN : 15 * MIN),
  chatgpt: (s) => (s.error ? 10 * MIN : 5 * MIN),
  gemini: (s) => (s.error ? 10 * MIN : 5 * MIN),
  grok: () => 60 * MIN,
  cursor: () => 30 * MIN,
  glm: (s) => (s.error ? 10 * MIN : 5 * MIN),
};

export function limitSource(tool: LimitTool): Source<ToolReading> {
  return lazy<ToolReading>(`limit.${tool}`, () => ({ key: tool, fetch: FETCH[tool], every: EVERY[tool], persist: true, onData: onReading }));
}

export function claudeLocalSource(): Source<ClaudeLocal> {
  return lazy<ClaudeLocal>("claudeLocal", () => ({
    key: "claudeLocal",
    fetch: () => call<ClaudeLocal>("ai", "claude_local"),
    every: (s) => (s.data?.pending ? 20_000 : MIN),
    onData: (d) => {
      // History changed since the limits were last read: read them again (at most every 2 min).
      const usage = limitSource("claude");
      if (d.lastActivity && d.lastActivity > usage.lastFetch) usage.nudge(2 * MIN);
    },
  }));
}

export function openCodeSource(): Source<OpenCodeUsage> {
  return lazy<OpenCodeUsage>("opencode", () => ({
    key: "opencode",
    fetch: () => call<OpenCodeUsage>("ai", "opencode_usage"),
    every: () => 2 * MIN,
    persist: true,
  }));
}

export function deepSeekSource(): Source<DeepSeekBalance> {
  return lazy<DeepSeekBalance>("deepseek", () => ({
    key: "deepseek",
    fetch: fetchDeepSeek,
    every: (s) => (s.error ? 15 * MIN : 10 * MIN),
    persist: true,
    onData: recordBalance,
  }));
}

export interface View<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  updatedAt: number | undefined;
  fromCache: boolean;
  refresh: () => void;
  sample: boolean;
}

function sampleView<T>(data: T): View<T> {
  return { data, error: undefined, loading: false, updatedAt: undefined, fromCache: false, refresh: () => {}, sample: true };
}

const GLM_NOT_CONNECTED: ToolReading = {
  tool: "glm",
  status: "signed_out",
  message: "Connect GLM from the GLM Usage tile first, with a key from Z.ai or BigModel.",
  limits: [],
  source: "none",
  fetchedAt: 0,
  details: [],
};

/** A tool's limits. `sample` shows sample numbers and fetches nothing. */
export function useLimitTool(tool: LimitTool, sample: boolean, enabled = true): View<ToolReading> {
  const glmConnected = useIsConnected("ai.glm");
  const live = enabled && !sample && (tool !== "glm" || glmConnected);
  const s = useSource(limitSource(tool), live);
  // The Claude tiles also follow Claude Code's history, which speeds up refreshes while it is used.
  useSource(claudeLocalSource(), live && tool === "claude");
  const demo = useMemo(() => (sample ? sampleReading(tool) : undefined), [sample, tool]);
  if (sample && demo) return sampleView(demo);
  if (tool === "glm" && !glmConnected) return { ...sampleView(GLM_NOT_CONNECTED), sample: false };
  return { data: s.data, error: s.error, loading: s.loading, updatedAt: s.updatedAt, fromCache: s.fromCache, refresh: s.refresh, sample: false };
}

export function useClaudeLocal(sample: boolean, enabled = true): View<ClaudeLocal> {
  const s = useSource(claudeLocalSource(), enabled && !sample);
  const demo = useMemo(() => (sample ? sampleClaudeLocal() : undefined), [sample]);
  if (sample && demo) return sampleView(demo);
  return { ...s, sample: false };
}

export function useOpenCode(sample: boolean): View<OpenCodeUsage> {
  const s = useSource(openCodeSource(), !sample);
  const demo = useMemo(() => (sample ? sampleOpenCode() : undefined), [sample]);
  if (sample && demo) return sampleView(demo);
  return { ...s, sample: false };
}

export function useDeepSeek(sample: boolean): View<DeepSeekBalance> {
  const s = useSource(deepSeekSource(), !sample);
  return { ...s, sample };
}

/** A status that means "this tool is set up on this PC" (even if its sign-in needs renewing). */
export function isDetected(status: string | undefined): boolean {
  return status === "ok" || status === "expired" || status === "preview";
}

/**
 * While a local-sign-in tile is still a sample, look once for the tool's sign-in and connect
 * the tile as soon as it is found (the tile switches to real numbers once the login turns up).
 * Picker previews and tests never probe.
 */
export function useAutoConnect(widgetId: string, tool: LimitTool | "opencode", isSample: boolean, instanceId: string): void {
  useEffect(() => {
    if (!isSample || /^(preview|test):/.test(instanceId)) return;
    let alive = true;
    const src = tool === "opencode" ? openCodeSource() : limitSource(tool);
    void src.refresh().then(() => {
      const status = (src.getState().data as { status?: string } | undefined)?.status;
      if (alive && isDetected(status)) setConnected(widgetId, true);
    });
    return () => {
      alive = false;
    };
  }, [widgetId, tool, isSample, instanceId]);
}
