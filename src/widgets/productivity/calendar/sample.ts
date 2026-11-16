import type { CalendarItem } from "./sources";

/** Believable items around "now" for the picker preview and an empty calendar. */
export function sampleItems(now = Date.now()): CalendarItem[] {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const d0 = day.getTime();
  const at = (days: number, h: number, m = 0) => d0 + days * 86_400_000 + (h * 60 + m) * 60_000;
  const soon = Math.ceil((now + 25 * 60_000) / (5 * 60_000)) * 5 * 60_000;
  return [
    { id: "s1", title: "Design review", start: soon, end: soon + 45 * 60_000, kind: "meeting", source: "Work", url: "https://meet.google.com/", color: "#4f8cff" },
    { id: "s2", title: "1:1 with Sam", start: at(1, 10), end: at(1, 10, 30), kind: "meeting", source: "Work", color: "#4f8cff" },
    { id: "s3", title: "Claude weekly limit resets", start: at(1, 15), kind: "limit-reset", source: "Claude" },
    { id: "s4", title: "Stripe payout", start: at(2, 0), allDay: true, kind: "payout", source: "Stripe", detail: "$1,284.50" },
    { id: "s5", title: "ChatGPT Plus renews", start: at(4, 0), allDay: true, kind: "renewal", source: "ChatGPT", detail: "$20.00" },
    { id: "s6", title: "Dentist", start: at(6, 16, 30), end: at(6, 17, 15), kind: "event", source: "Personal", color: "#34c77b" },
    { id: "s7", title: "Team offsite", start: at(9, 0), end: at(11, 0), allDay: true, kind: "event", source: "Work", color: "#4f8cff" },
    { id: "s8", title: "Polar payout", start: at(12, 0), allDay: true, kind: "payout", source: "Polar", detail: "$412.00" },
    { id: "s9", title: "Gym", start: at(-2, 18), end: at(-2, 19), kind: "event", source: "Personal", color: "#34c77b" },
  ];
}
