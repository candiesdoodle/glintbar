/** Automation and alert preferences, persisted as "automations.settings". */
import { createPersistedStore } from "../core/store";
import type { SoundId } from "./sounds";

export type RuleId = "pauseMusic" | "eventHeadsUp" | "aiLimit" | "renewal" | "screenSummary" | "reviewTodo";

export type AlertKind = "timer" | "pomodoro" | "calendar" | "todo" | "automation";

export interface AutomationSettings {
  rules: Record<RuleId, boolean>;
  quiet: { enabled: boolean; from: string; to: string };
  sound: SoundId | "none";
  volume: number;
  /** Which kinds of alert play the sound. */
  soundFor: Record<AlertKind, boolean>;
  /** Minutes before a meeting to pause music. */
  meetingLeadMin: number;
  /** Minutes before an event for the heads-up. */
  eventLeadMin: number;
  /** Days before a renewal. */
  renewalLeadDays: number;
  /** Warn when an AI limit is this % used. */
  aiThreshold: number;
  /** "21:00" - when the daily screen-time summary shows. */
  summaryTime: string;
}

export const DEFAULT_AUTOMATIONS: AutomationSettings = {
  rules: { pauseMusic: true, eventHeadsUp: true, aiLimit: true, renewal: true, screenSummary: true, reviewTodo: false },
  quiet: { enabled: false, from: "22:00", to: "07:30" },
  sound: "chime",
  volume: 0.6,
  soundFor: { timer: true, pomodoro: true, calendar: true, todo: true, automation: false },
  meetingLeadMin: 1,
  eventLeadMin: 10,
  renewalLeadDays: 3,
  aiThreshold: 85,
  summaryTime: "21:00",
};

export const useAutomations = createPersistedStore<AutomationSettings>("automations.settings", DEFAULT_AUTOMATIONS, (saved) => {
  // Nested objects are merged too, so new rules get their default.
  const s = saved as Partial<AutomationSettings>;
  return {
    ...s,
    rules: { ...DEFAULT_AUTOMATIONS.rules, ...(s.rules ?? {}) },
    quiet: { ...DEFAULT_AUTOMATIONS.quiet, ...(s.quiet ?? {}) },
    soundFor: { ...DEFAULT_AUTOMATIONS.soundFor, ...(s.soundFor ?? {}) },
  };
});

export function setRule(id: RuleId, on: boolean): void {
  useAutomations.setState((s) => ({ rules: { ...s.rules, [id]: on } }));
}

export function updateAutomations(patch: Partial<AutomationSettings>): void {
  useAutomations.setState(patch);
}

/** "22:00" -> minutes since midnight (NaN when malformed). */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/** True when `at` falls inside quiet hours (which may wrap midnight). */
export function inQuietHours(quiet: AutomationSettings["quiet"], at: Date = new Date()): boolean {
  if (!quiet.enabled) return false;
  const from = parseHm(quiet.from);
  const to = parseHm(quiet.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** The next moment quiet hours end, or null when not in them. */
export function quietEndsAt(quiet: AutomationSettings["quiet"], at: Date = new Date()): number | null {
  if (!inQuietHours(quiet, at)) return null;
  const to = parseHm(quiet.to);
  const end = new Date(at);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end.getTime() <= at.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime();
}
