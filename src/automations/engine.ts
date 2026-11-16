/**
 * The local rules engine. Every rule is one switch in Settings > Automations. Rules read what
 * other widgets already know (the calendar, AI limits, screen time, review requests) and stay
 * quiet when that data is missing: a slice that is not connected simply never triggers them.
 *
 * Runs on a 30-second clock plus exact timers for things due in the next few minutes. Each
 * firing is remembered ("automations.fired") so a restart never repeats an alert.
 */
import { BellRing, CalendarClock, Gauge, GitPullRequest, Hourglass, Music2, RefreshCcw } from "lucide-react";
import { call } from "../core/backend";
import { duration } from "../core/format";
import { getStored, setStored } from "../core/store";
import { allCalendarItems } from "../widgets/productivity/calendar/store";
import type { CalendarItem } from "../widgets/productivity/calendar/sources";
import { runsBackground } from "../widgets/productivity/shared/env";
import { openWidgetCard } from "../widgets/productivity/shared/openCard";
import { untilText } from "../widgets/productivity/shared/time";
import { todoActions } from "../widgets/productivity/todos/store";
import { notify } from "./alerts";
import { scheduleAt } from "./scheduler";
import { parseHm, useAutomations, type AutomationSettings } from "./settings";
import { currentAiLimits, currentReviewRequests, onSignals } from "./signals";

const FIRED_KEY = "automations.fired";
const KEEP_FIRED_MS = 21 * 86_400_000;

function wasFired(key: string): boolean {
  return Boolean(getStored<Record<string, number>>(FIRED_KEY, {})[key]);
}

function markFired(key: string): void {
  const now = Date.now();
  const all = getStored<Record<string, number>>(FIRED_KEY, {});
  const next: Record<string, number> = {};
  for (const [k, t] of Object.entries(all)) if (now - t < KEEP_FIRED_MS) next[k] = t;
  next[key] = now;
  setStored(FIRED_KEY, next);
}

/** Runs `fn` once per key, ever (within three weeks). */
function once(key: string, fn: () => void): void {
  if (wasFired(key)) return;
  markFired(key);
  fn();
}

// ---- media ------------------------------------------------------------------------------------

/** Asks the media service to pause. Tolerates a media slice that is missing or named differently. */
export async function pauseMedia(): Promise<boolean> {
  const attempts: Array<[string, unknown]> = [
    ["control", { action: "pause" }],
    ["pause", undefined],
  ];
  for (const [method, args] of attempts) {
    try {
      await call("media", method, args);
      return true;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "unknown_method" && code !== "bad_args") return false;
    }
  }
  return false;
}

// ---- rules ------------------------------------------------------------------------------------

export interface RuleDef {
  id: keyof AutomationSettings["rules"];
  title: string;
  description: (s: AutomationSettings) => string;
}

export const RULES: RuleDef[] = [
  { id: "pauseMusic", title: "Pause music for meetings", description: (s) => `Stops playback ${s.meetingLeadMin} min before a meeting on your calendar begins.` },
  { id: "eventHeadsUp", title: "Event reminders", description: (s) => `Alerts you ${s.eventLeadMin} min ahead of every event with a start time. Video calls get a Join button.` },
  { id: "aiLimit", title: "AI limit warning", description: (s) => `Alerts you once an AI plan reaches ${s.aiThreshold}% of a limit and says when it resets.` },
  { id: "renewal", title: "Renewal reminder", description: (s) => `Alerts you ${s.renewalLeadDays} day${s.renewalLeadDays === 1 ? "" : "s"} ahead of a renewal on your calendar, so you can cancel in time.` },
  { id: "screenSummary", title: "Daily screen-time summary", description: (s) => `Each day at ${s.summaryTime}, your PC time and most-used apps. On Mondays it adds last week's total.` },
  { id: "reviewTodo", title: "Add pull request reviews to To-dos", description: () => "Pull requests that ask for your review go on your To-dos list." },
];

const MIN = 60_000;

function upcoming(items: CalendarItem[], now: number, within: number, filter: (i: CalendarItem) => boolean): CalendarItem[] {
  return items.filter((i) => i.start > now - MIN && i.start <= now + within && filter(i));
}

function meetingRule(s: AutomationSettings, items: CalendarItem[], now: number) {
  const lead = s.meetingLeadMin * MIN;
  for (const m of upcoming(items, now, lead + 5 * MIN, (i) => i.kind === "meeting" && !i.allDay)) {
    const key = `meeting:${m.id}:${m.start}`;
    if (wasFired(key)) continue;
    scheduleAt(`auto.${key}`, m.start - lead, () => {
      if (!useAutomations.getState().rules.pauseMusic) return;
      once(key, () => {
        void pauseMedia().then((paused) => {
          if (paused) notify({ kind: "automation", icon: Music2, title: "Music paused: meeting ahead", body: `${m.title} starts ${untilText(m.start, Date.now())}.`, silent: true });
        });
      });
    });
  }
}

function headsUpRule(s: AutomationSettings, items: CalendarItem[], now: number) {
  const lead = s.eventLeadMin * MIN;
  for (const ev of upcoming(items, now, lead + 5 * MIN, (i) => (i.kind === "meeting" || i.kind === "event") && !i.allDay)) {
    const key = `event:${ev.id}:${ev.start}`;
    if (wasFired(key)) continue;
    scheduleAt(`auto.${key}`, ev.start - lead, () => {
      if (!useAutomations.getState().rules.eventHeadsUp) return;
      once(key, () =>
        notify({
          kind: "calendar",
          key,
          icon: CalendarClock,
          title: ev.title,
          body: `Starts ${untilText(ev.start, Date.now())}${ev.location && !/^https?:/.test(ev.location) ? ` · ${ev.location}` : ""}`,
          sticky: true,
          actions: ev.url ? [{ label: ev.kind === "meeting" ? "Join" : "Open", primary: true, run: () => void call("shell", "open", { target: ev.url }).catch(() => {}) }] : undefined,
        }),
      );
    });
  }
}

function renewalRule(s: AutomationSettings, items: CalendarItem[], now: number) {
  const within = s.renewalLeadDays * 86_400_000;
  for (const r of upcoming(items, now, within, (i) => i.kind === "renewal")) {
    once(`renewal:${r.id}:${r.start}`, () =>
      notify({
        kind: "automation",
        icon: RefreshCcw,
        title: `${r.title} renews ${untilText(r.start, now)}`,
        body: [r.detail, "Cancel before then if you no longer use it."].filter(Boolean).join(" · "),
        sticky: true,
        actions: r.url ? [{ label: "Manage plan", primary: true, run: () => void call("shell", "open", { target: r.url }).catch(() => {}) }] : undefined,
      }),
    );
  }
}

function aiRule(s: AutomationSettings, now: number) {
  for (const l of currentAiLimits()) {
    if (l.usedPct < s.aiThreshold) continue;
    if (l.resetsAt && l.resetsAt <= now) continue;
    // One warning per limit window (keyed by its reset time, rounded to the hour).
    const windowKey = l.resetsAt ? Math.round(l.resetsAt / 3600_000) : new Date(now).toDateString();
    once(`ai:${l.source}:${l.id}:${windowKey}`, () =>
      notify({
        kind: "automation",
        icon: Gauge,
        title: `${l.label} is ${Math.round(l.usedPct)}% used`,
        body: l.resetsAt ? `It resets ${untilText(l.resetsAt, now)}.` : "Go easy on it until the limit resets.",
      }),
    );
  }
}

interface DayTotals {
  totalSecs: number;
  apps: Array<{ name: string; secs: number }>;
}

async function summaryRule(s: AutomationSettings, now: number) {
  const at = parseHm(s.summaryTime);
  if (!Number.isFinite(at)) return;
  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  // Show it in the hour after the chosen time (so a PC woken at 21:20 still gets it).
  if (minutes < at || minutes > at + 60) return;
  const key = `summary:${d.toDateString()}`;
  if (wasFired(key)) return;
  markFired(key);
  try {
    const day = await call<DayTotals>("productivity", "screentime_day", {});
    if (!day || day.totalSecs < 60) return;
    const top = day.apps.slice(0, 3).map((a) => `${a.name} ${duration(a.secs)}`).join(" · ");
    let body = top ? `Most time: ${top}` : undefined;
    if (d.getDay() === 1) {
      const week = await call<Array<{ totalSecs: number }>>("productivity", "screentime_days", { days: 8 }).catch(() => null);
      if (week && week.length > 1) {
        const last = week.slice(0, -1).reduce((a, x) => a + x.totalSecs, 0);
        body = `Last week: ${duration(last)}. ${body ?? ""}`.trim();
      }
    }
    notify({
      kind: "automation",
      icon: Hourglass,
      title: `Today: ${duration(day.totalSecs)} at the PC`,
      body,
      sticky: true,
      actions: [{ label: "Details", primary: true, run: () => void openWidgetCard("productivity.screentime") }],
    });
  } catch {
    // Screen Time not available (browser preview without data, or not on Windows).
  }
}

function reviewRule() {
  if (!useAutomations.getState().rules.reviewTodo) return;
  for (const r of currentReviewRequests()) {
    const ref = `review:${r.source}:${r.id}`;
    const added = todoActions.add(`Review: ${r.title}`, { ref, source: r.from ?? "Review request", url: r.url });
    if (added) notify({ kind: "automation", icon: GitPullRequest, title: "New to-do from a review request", body: r.title, silent: true });
  }
}

/** One pass over every enabled rule. Exported for tests and the Settings "Run now". */
export function runRules(now = Date.now()): void {
  const s = useAutomations.getState();
  let items: CalendarItem[] = [];
  try {
    items = allCalendarItems();
  } catch {
    items = [];
  }
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.warn("automation failed", e);
    }
  };
  if (s.rules.pauseMusic) guard(() => meetingRule(s, items, now));
  if (s.rules.eventHeadsUp) guard(() => headsUpRule(s, items, now));
  if (s.rules.renewal) guard(() => renewalRule(s, items, now));
  if (s.rules.aiLimit) guard(() => aiRule(s, now));
  if (s.rules.reviewTodo) guard(() => reviewRule());
  if (s.rules.screenSummary) void summaryRule(s, now);
}

let started = false;

export function startEngine(): void {
  if (started || !runsBackground || typeof window === "undefined") return;
  started = true;
  // Give the store a moment to load before the first pass.
  setTimeout(() => runRules(), 5000);
  setInterval(() => runRules(), 30_000);
  onSignals(() => {
    const s = useAutomations.getState();
    if (s.rules.aiLimit) aiRule(s, Date.now());
    reviewRule();
  });
}

/** A sample alert for the Settings page. */
export function testAlert(): void {
  notify({ kind: "timer", icon: BellRing, title: "Sample alert", body: "Alerts show up above the dock and play your chosen sound." });
}
