/**
 * One calendar for everything with a date. Other slices add their own dated items here
 * (renewals, payouts, AI limit resets, milestones); the Calendar widget and the automations
 * engine read them next to the user's iCal calendars and local events.
 *
 *   import { calendarSources } from "../../productivity/calendar/sources";
 *   calendarSources.set("finance.stripe", [
 *     { id: "po_123", title: "Stripe payout", start: Date.parse("2026-11-20"), allDay: true, kind: "payout", source: "Stripe" },
 *   ]);
 *   calendarSources.clear("finance.stripe");   // e.g. on disconnect
 *
 * `set` replaces everything that source added before. Items are persisted, so they survive a
 * restart even if the contributing tile is not on the dock.
 */
import { useMemo } from "react";
import { getStored, setStored, subscribeKey, useStored } from "../../../core/store";

export type CalendarItemKind = "event" | "meeting" | "renewal" | "payout" | "limit-reset" | "milestone" | "reminder" | "holiday";

export interface CalendarItem {
  /** Unique within its source. */
  id: string;
  title: string;
  /** Unix ms. For all-day items: local midnight of the day. */
  start: number;
  end?: number;
  allDay?: boolean;
  kind: CalendarItemKind;
  /** Display name of where it came from: "Stripe", "Work calendar". */
  source?: string;
  /** CSS colour for the dot; defaults by kind. */
  color?: string;
  url?: string;
  location?: string;
  /** Plan price etc., shown under the title. */
  detail?: string;
}

const KEY = "productivity.calendarSources";

type Saved = Record<string, { updatedAt: number; items: CalendarItem[] }>;

function flatten(saved: Saved): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const [sourceId, entry] of Object.entries(saved ?? {})) {
    for (const item of entry?.items ?? []) {
      if (!item || typeof item.start !== "number" || !Number.isFinite(item.start)) continue;
      out.push({ ...item, id: `${sourceId}:${item.id}`, source: item.source ?? sourceId });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export const calendarSources = {
  /** Replaces the items contributed by `sourceId` (e.g. "finance.stripe"). */
  set(sourceId: string, items: CalendarItem[]): void {
    const saved = { ...getStored<Saved>(KEY, {}) };
    saved[sourceId] = { updatedAt: Date.now(), items: items.slice(0, 500) };
    setStored(KEY, saved);
  },
  clear(sourceId: string): void {
    const saved = { ...getStored<Saved>(KEY, {}) };
    if (!(sourceId in saved)) return;
    delete saved[sourceId];
    setStored(KEY, saved);
  },
  /** Every contributed item, sorted by start. */
  items(): CalendarItem[] {
    return flatten(getStored<Saved>(KEY, {}));
  },
  subscribe(cb: () => void): () => void {
    return subscribeKey(KEY, cb);
  },
};

export function useContributedItems(): CalendarItem[] {
  const [saved] = useStored<Saved>(KEY, {});
  return useMemo(() => flatten(saved), [saved]);
}

export const KIND_COLORS: Record<CalendarItemKind, string> = {
  event: "var(--g-accent)",
  meeting: "#4f8cff",
  renewal: "var(--g-warn)",
  payout: "var(--g-good)",
  "limit-reset": "#b57bff",
  milestone: "#ff7ab6",
  reminder: "#2bc0c9",
  holiday: "#e0a050",
};

export const KIND_LABELS: Record<CalendarItemKind, string> = {
  event: "Event",
  meeting: "Meeting",
  renewal: "Renewal",
  payout: "Payout",
  "limit-reset": "Limit reset",
  milestone: "Milestone",
  reminder: "Reminder",
  holiday: "Holiday",
};
