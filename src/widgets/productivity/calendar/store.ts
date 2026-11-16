/**
 * Calendar state: iCal subscriptions (the secret address lives in the secrets store, never in
 * store.json), events added in GlintBar, and the expanded occurrences of each feed (cached so the
 * calendar shows something right after a restart). Feeds refresh every 15 minutes.
 */
import { useMemo } from "react";
import { isTauri } from "../../../core/backend";
import { HttpError, httpRaw } from "../../../core/http";
import { secretRef, secrets } from "../../../core/secrets";
import { createPersistedStore, getStored, setStored, subscribeKey, useStored } from "../../../core/store";
import { runsBackground } from "../shared/env";
import { parseIcs } from "./ics";
import { calendarSources, useContributedItems, type CalendarItem } from "./sources";

export type Provider = "google" | "outlook" | "icloud" | "other";

export interface Feed {
  id: string;
  name: string;
  color: string;
  provider: Provider;
  addedAt: number;
  lastFetch?: number;
  lastOk?: number;
  /** Plain-language problem from the last refresh. */
  error?: string;
  count?: number;
}

export interface LocalEvent {
  id: string;
  title: string;
  start: number;
  end?: number;
  allDay?: boolean;
}

interface CalendarState {
  feeds: Feed[];
  local: LocalEvent[];
}

export const useCalendar = createPersistedStore<CalendarState>("productivity.calendar", { feeds: [], local: [] });

const CACHE_KEY = "productivity.calendarCache";
type Cache = Record<string, CalendarItem[]>;

export const REFRESH_MS = 15 * 60_000;
const PAST_DAYS = 35;
const FUTURE_DAYS = 400;

const FEED_COLORS = ["#4f8cff", "#34c77b", "#ff7a59", "#b57bff", "#f5a524", "#2bc0c9", "#ff5f8f"];

export function feedSecretKey(id: string): string {
  return `productivity.calendar.feed.${id}`;
}

export function detectProvider(url: string): Provider {
  const u = url.toLowerCase();
  if (u.includes("calendar.google.com")) return "google";
  if (u.includes("outlook.") || u.includes("office365") || u.includes("live.com")) return "outlook";
  if (u.includes("icloud.com")) return "icloud";
  return "other";
}

export const PROVIDER_NAMES: Record<Provider, string> = { google: "Google Calendar", outlook: "Outlook", icloud: "iCloud", other: "Calendar" };

/** webcal:// -> https://, trims whitespace and stray quotes. */
export function normaliseFeedUrl(raw: string): string {
  let u = raw.trim().replace(/^["'<]+|["'>]+$/g, "");
  if (/^webcals?:\/\//i.test(u)) u = u.replace(/^webcals?:\/\//i, "https://");
  return u;
}

/** Turns a failed fetch into the words the card shows. */
function feedProblem(e: unknown, provider: Provider, everWorked: boolean): string {
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403 || e.status === 404) {
      if (everWorked) return `This calendar used to load but now returns ${e.status}. Its secret link has likely been reset, so add the new one.`;
      return provider === "google"
        ? `Google returned ${e.status}. A private Google calendar opens only through its secret link, the one labelled "Secret address in iCal format".`
        : `The server returned ${e.status}. Make sure the link you pasted is the private iCal one.`;
    }
    if (e.kind === "offline" || e.kind === "timeout") return "No connection to this calendar right now; GlintBar will retry in 15 minutes.";
    if (e.kind === "not_connected") return "GlintBar no longer has this calendar's link. Delete it and paste the link again.";
    return e.message;
  }
  if (e instanceof Error && e.message === "not an iCalendar file") return "The link did not return an iCal (.ics) file. Copy the calendar's iCal link, not the page you view it on.";
  return "GlintBar could not read this calendar.";
}

async function fetchFeedText(id: string): Promise<string> {
  // Inside GlintBar the secret address is substituted by Rust; the browser preview has no secrets.
  const url = isTauri ? secretRef(feedSecretKey(id)) : ((await secrets.get(feedSecretKey(id))) ?? "");
  const res = await httpRaw(url, { headers: { Accept: "text/calendar, */*" }, timeoutMs: 20_000 });
  if (!res.ok) throw new HttpError(res.status === 404 ? "not_found" : res.status === 401 ? "unauthorized" : "server", res.status);
  return res.body;
}

function toItems(feed: Feed, text: string): { name?: string; items: CalendarItem[] } {
  const now = Date.now();
  const cal = parseIcs(text, now - PAST_DAYS * 86_400_000, now + FUTURE_DAYS * 86_400_000);
  const items: CalendarItem[] = cal.events.slice(0, 1500).map((e) => ({
    id: `${feed.id}:${e.uid}@${e.start}`,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    kind: e.meeting ? "meeting" : "event",
    source: feed.name,
    color: feed.color,
    url: e.url,
    location: e.location,
  }));
  return { name: cal.name, items };
}

function patchFeed(id: string, patch: Partial<Feed>) {
  useCalendar.setState((s) => ({ feeds: s.feeds.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
}

const inflight = new Map<string, Promise<void>>();

export function refreshFeed(id: string): Promise<void> {
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    const feed = useCalendar.getState().feeds.find((f) => f.id === id);
    if (!feed) return;
    try {
      const text = await fetchFeedText(id);
      const { items } = toItems(feed, text);
      setStored(CACHE_KEY, { ...getStored<Cache>(CACHE_KEY, {}), [id]: items });
      patchFeed(id, { lastFetch: Date.now(), lastOk: Date.now(), error: undefined, count: items.length });
    } catch (e) {
      patchFeed(id, { lastFetch: Date.now(), error: feedProblem(e, feed.provider, Boolean(feed.lastOk)) });
    }
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Validates and adds an iCal address. Resolves to an error message, or null when added. */
export async function addFeed(raw: string): Promise<string | null> {
  const url = normaliseFeedUrl(raw);
  if (!/^https?:\/\/\S+$/i.test(url)) return "An iCal link begins with https:// or webcal:// - paste one of those.";
  const provider = detectProvider(url);
  const state = useCalendar.getState();
  const id = `f${Date.now().toString(36)}`;
  const key = feedSecretKey(id);
  await secrets.set(key, url);
  try {
    const text = await fetchFeedText(id);
    const feed: Feed = { id, name: PROVIDER_NAMES[provider], color: FEED_COLORS[state.feeds.length % FEED_COLORS.length], provider, addedAt: Date.now() };
    const { name, items } = toItems(feed, text);
    feed.name = name ?? feed.name;
    feed.lastFetch = feed.lastOk = Date.now();
    feed.count = items.length;
    for (const i of items) i.source = feed.name;
    setStored(CACHE_KEY, { ...getStored<Cache>(CACHE_KEY, {}), [id]: items });
    useCalendar.setState((s) => ({ feeds: [...s.feeds, feed] }));
    return null;
  } catch (e) {
    await secrets.delete(key).catch(() => {});
    return feedProblem(e, provider, false);
  }
}

export async function removeFeed(id: string): Promise<void> {
  useCalendar.setState((s) => ({ feeds: s.feeds.filter((f) => f.id !== id) }));
  const cache = { ...getStored<Cache>(CACHE_KEY, {}) };
  delete cache[id];
  setStored(CACHE_KEY, cache);
  await secrets.delete(feedSecretKey(id)).catch(() => {});
}

export function renameFeed(id: string, name: string): void {
  patchFeed(id, { name: name.trim() || "Calendar" });
}

export function addLocalEvent(ev: Omit<LocalEvent, "id">): void {
  useCalendar.setState((s) => ({ local: [...s.local, { ...ev, id: `l${Date.now().toString(36)}` }].sort((a, b) => a.start - b.start) }));
}

export function removeLocalEvent(id: string): void {
  useCalendar.setState((s) => ({ local: s.local.filter((e) => e.id !== id) }));
}

function localItems(local: LocalEvent[]): CalendarItem[] {
  return local.map((e) => ({ id: `local:${e.id}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay, kind: "event" as const, source: "GlintBar" }));
}

function feedItems(cache: Cache, feeds: Feed[]): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const f of feeds) for (const i of cache[f.id] ?? []) out.push({ ...i, color: f.color, source: f.name });
  return out;
}

/** Everything on the calendar, sorted by start (feeds + local + other slices). */
export function allCalendarItems(): CalendarItem[] {
  const s = useCalendar.getState();
  return [...feedItems(getStored<Cache>(CACHE_KEY, {}), s.feeds), ...localItems(s.local), ...calendarSources.items()].sort((a, b) => a.start - b.start);
}

export function useCalendarItems(): { items: CalendarItem[]; hasOwnData: boolean } {
  const feeds = useCalendar((s) => s.feeds);
  const local = useCalendar((s) => s.local);
  const [cache] = useStored<Cache>(CACHE_KEY, {});
  const contributed = useContributedItems();
  return useMemo(() => {
    const items = [...feedItems(cache, feeds), ...localItems(local), ...contributed].sort((a, b) => a.start - b.start);
    return { items, hasOwnData: feeds.length > 0 || local.length > 0 || contributed.length > 0 };
  }, [cache, feeds, local, contributed]);
}

/** The item that is next (or happening now, for timed items), skipping all-day items unless nothing else. */
export function nextItem(items: CalendarItem[], now: number): CalendarItem | undefined {
  const timed = items.find((i) => !i.allDay && (i.end ?? i.start) > now && i.start > now - 5 * 60_000);
  if (timed && timed.start - now < 24 * 3600_000) return timed;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const allDay = items.find((i) => i.allDay && i.start >= today.getTime());
  if (timed && (!allDay || timed.start < allDay.start + 86_400_000)) return timed;
  return allDay ?? timed;
}

// ---- background sync ----------------------------------------------------------------------------

let syncStarted = false;

/** Refreshes stale feeds now and every 15 minutes (only while there are feeds). */
export function startCalendarSync(): void {
  if (syncStarted || !runsBackground || typeof window === "undefined") return;
  syncStarted = true;
  const due = () => {
    const now = Date.now();
    for (const f of useCalendar.getState().feeds) {
      if (!f.lastFetch || now - f.lastFetch >= REFRESH_MS - 30_000) void refreshFeed(f.id);
    }
  };
  // After the store has loaded (hydration triggers a change), and on a 15-minute clock.
  subscribeKey("productivity.calendar", () => setTimeout(due, 2000));
  setTimeout(due, 4000);
  setInterval(due, REFRESH_MS);
}
