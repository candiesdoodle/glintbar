/**
 * Publishes AI limit resets and "limit nearly out" signals for the calendar and automations.
 *
 * - store key "ai.signals": { updatedAt, items: AiSignal[] } - every known window, any slice can read it
 * - window events "glintbar:ai-limits" (all items) and "glintbar:ai-limit-nearly-out" (one AiSignal, once
 *   per window when it crosses NEARLY_OUT_PCT)
 * - the productivity calendar, when that module is present: reset times as "limit-reset" items and
 *   plan renewals as "renewal" items (loaded lazily, never a hard dependency)
 */
import { getStored, setStored } from "../../../core/store";
import { NEARLY_OUT_PCT, pct } from "./format";
import { TOOLS } from "./tools";
import type { ToolId, ToolReading } from "./types";

export interface AiSignal {
  id: string;
  tool: ToolId;
  toolName: string;
  window: string;
  label: string;
  usedPct: number;
  resetsAt: number | null;
  nearlyOut: boolean;
  at: number;
}

interface Saved {
  updatedAt: number;
  items: AiSignal[];
}

const KEY = "ai.signals";

/** Pure: the signals for one reading. */
export function signalsFor(r: ToolReading, at: number): AiSignal[] {
  if (r.status !== "ok") return [];
  const name = TOOLS[r.tool]?.name ?? r.tool;
  return r.limits.map((l) => ({
    id: `${r.tool}:${l.window}`,
    tool: r.tool,
    toolName: name,
    window: l.window,
    label: l.label,
    usedPct: l.usedPct,
    resetsAt: l.resetsAt,
    nearlyOut: l.usedPct >= NEARLY_OUT_PCT,
    at,
  }));
}

interface CalendarLikeItem {
  id: string;
  title: string;
  start: number;
  allDay?: boolean;
  kind: string;
  source?: string;
  detail?: string;
}

/** Pure: calendar items for one reading (future resets and the next renewal). */
export function calendarItemsFor(r: ToolReading, now: number): CalendarLikeItem[] {
  const name = TOOLS[r.tool]?.name ?? r.tool;
  const items: CalendarLikeItem[] = [];
  if (r.status === "ok") {
    for (const l of r.limits) {
      if (!l.resetsAt || l.resetsAt <= now) continue;
      items.push({
        id: `reset-${l.window}`,
        title: `${name} ${l.label.toLowerCase()} limit resets`,
        start: l.resetsAt,
        kind: "limit-reset",
        source: name,
        detail: `${pct(l.usedPct)} used`,
      });
    }
  }
  const next = r.billing?.nextCharge;
  if (next && next > now) {
    const d = new Date(next);
    items.push({
      id: "renewal",
      title: `${name}${r.plan ? ` ${r.plan}` : ""} renews`,
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
      allDay: true,
      kind: "renewal",
      source: name,
      detail: r.billing?.estimated ? "≈ estimated from the plan's start date" : undefined,
    });
  }
  return items;
}

const calendarModule = import.meta.glob("../../productivity/calendar/sources.ts");
const pushed = new Map<string, string>();

async function pushCalendar(tool: ToolId, items: CalendarLikeItem[]): Promise<void> {
  const load = Object.values(calendarModule)[0];
  if (!load) return;
  const fingerprint = JSON.stringify(items);
  if (pushed.get(tool) === fingerprint) return;
  try {
    const mod = (await load()) as { calendarSources?: { set?: (id: string, items: unknown[]) => void } };
    mod.calendarSources?.set?.(`ai.${tool}`, items);
    pushed.set(tool, fingerprint);
  } catch {
    /* the calendar is optional */
  }
}

function emit(name: string, detail: unknown) {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* no DOM (tests) */
  }
}

export function publishReading(r: ToolReading, now = Date.now()): void {
  const saved = getStored<Saved>(KEY, { updatedAt: 0, items: [] });
  const before = new Map(saved.items.map((s) => [s.id, s]));
  const mine = r.status === "ok" || r.status === "expired" || r.status === "signed_out" || r.status === "not_installed" ? signalsFor(r, now) : null;
  // Keep the previous items for a tool whose reading is temporarily unusable (unavailable).
  const items = mine === null ? saved.items : [...saved.items.filter((s) => s.tool !== r.tool), ...mine];
  setStored(KEY, { updatedAt: now, items });
  for (const s of mine ?? []) {
    const prev = before.get(s.id);
    const sameWindow = prev && prev.resetsAt === s.resetsAt;
    if (s.nearlyOut && !(sameWindow && prev?.nearlyOut)) emit("glintbar:ai-limit-nearly-out", s);
  }
  emit("glintbar:ai-limits", items);
  void pushCalendar(r.tool, calendarItemsFor(r, now));
}
