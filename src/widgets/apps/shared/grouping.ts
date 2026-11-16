/**
 * Pure logic for the Apps tile: which windows belong to which pin, one icon per app, badges
 * from window titles, and what a click does. Unit-tested in grouping.test.ts.
 */
import { isGroup, type AppEntry, type Pin, type PinGroup, type WindowInfo } from "../types";

export interface DockApp {
  /** Stable key on the dock (pin id, group id, or the running app's identity). */
  key: string;
  name: string;
  icon: string;
  kind: AppEntry["kind"] | "group";
  pin?: AppEntry;
  group?: PinGroup;
  /** Windows in z-order (front-most first). */
  windows: WindowInfo[];
  active: boolean;
  flashing: boolean;
  hung: boolean;
  /** Unread count from window titles; 0 = "something new" without a number; null = none. */
  badge: number | null;
}

const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** One identity per app: its app id, else its program, else the window itself. */
export function windowKey(w: WindowInfo): string {
  if (w.aumid) return `aumid:${w.aumid.toLowerCase()}`;
  if (w.exe) return `exe:${w.exe.toLowerCase()}`;
  return `hwnd:${w.hwnd}`;
}

/** True when `w` is a window of the pinned entry. Two different app ids never match, even for
 *  the same program (a browser and its installed web apps). */
export function entryMatches(e: AppEntry, w: WindowInfo): boolean {
  if (e.kind === "file") return false;
  if (e.aumid && w.aumid) return eq(e.aumid, w.aumid);
  if (eq(e.exe, w.exe)) return true;
  if (e.kind === "folder" && w.exe?.endsWith("\\explorer.exe")) return eq(w.title, folderName(e.target));
  return false;
}

function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** "(3) Inbox", "Telegram (12)", "[5] Chat", "* Slack" -> 3, 12, 5, 0. */
export function parseBadge(title: string): number | null {
  const t = title.trim();
  const m = /^\((\d{1,4})\+?\)\s/.exec(t) ?? /\s\((\d{1,4})\+?\)$/.exec(t) ?? /^\[(\d{1,4})\]\s/.exec(t);
  if (m) {
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }
  if (/^[*!•]\s/.test(t)) return 0;
  return null;
}

function summarize(wins: WindowInfo[]) {
  let badge: number | null = null;
  for (const w of wins) {
    const b = parseBadge(w.title);
    if (b !== null) badge = Math.max(badge ?? 0, b);
  }
  return {
    active: wins.some((w) => w.foreground && !w.minimized),
    flashing: wins.some((w) => w.flashing),
    hung: wins.some((w) => w.hung),
    badge,
  };
}

export function windowIcon(w: WindowInfo): string {
  return w.aumid ? `aumid:${w.aumid}` : (w.exe ?? "");
}

/**
 * Pins first (in their order, with their windows), then every other app that has a window,
 * in the order they first appeared (`seen` remembers it between calls).
 */
export function buildDockApps(pins: Pin[], windows: WindowInfo[], opts: { showRunning: boolean; seen?: Map<string, number> }): DockApp[] {
  const used = new Set<number>();
  const out: DockApp[] = [];
  for (const pin of pins) {
    if (isGroup(pin)) {
      const wins = windows.filter((w) => pin.items.some((e) => entryMatches(e, w)));
      wins.forEach((w) => used.add(w.hwnd));
      out.push({ key: pin.id, name: pin.name, icon: "", kind: "group", group: pin, windows: wins, ...summarize(wins) });
    } else {
      const wins = windows.filter((w) => !used.has(w.hwnd) && entryMatches(pin, w));
      wins.forEach((w) => used.add(w.hwnd));
      out.push({ key: pin.id, name: pin.name, icon: pin.icon, kind: pin.kind, pin, windows: wins, ...summarize(wins) });
    }
  }
  if (!opts.showRunning) return out;
  const seen = opts.seen ?? new Map<string, number>();
  const groups = new Map<string, WindowInfo[]>();
  for (const w of windows) {
    if (used.has(w.hwnd)) continue;
    const k = windowKey(w);
    if (!seen.has(k)) seen.set(k, seen.size);
    const list = groups.get(k) ?? [];
    list.push(w);
    groups.set(k, list);
  }
  const running = [...groups.entries()].sort((a, b) => (seen.get(a[0]) ?? 0) - (seen.get(b[0]) ?? 0));
  for (const [key, wins] of running) {
    const first = wins[0];
    out.push({ key, name: first.appName || first.title, icon: windowIcon(first), kind: "app", windows: wins, ...summarize(wins) });
  }
  return out;
}

/** A pin for an app that is only running (Pin to dock). */
export function entryFromWindow(w: WindowInfo): AppEntry {
  return {
    id: w.aumid ? `aumid:${w.aumid.toLowerCase()}` : w.exe ? `exe:${w.exe.toLowerCase()}` : `hwnd:${w.hwnd}`,
    name: w.appName || w.title,
    kind: "app",
    target: w.aumid ? `shell:AppsFolder\\${w.aumid}` : (w.exe ?? ""),
    args: null,
    aumid: w.aumid ?? null,
    exe: w.exe ?? null,
    icon: windowIcon(w),
  };
}

export type ClickAction =
  | { type: "launch" }
  | { type: "open" }
  | { type: "stack" }
  | { type: "group" }
  | { type: "toggle"; hwnd: number }
  | { type: "focus"; hwnd: number };

/** What a left click does, the taskbar's way. */
export function clickAction(app: DockApp): ClickAction {
  if (app.kind === "group") return { type: "group" };
  if (app.windows.length === 0) {
    if (app.kind === "folder") return { type: "stack" };
    if (app.kind === "file") return { type: "open" };
    return { type: "launch" };
  }
  if (app.windows.length === 1) return { type: "toggle", hwnd: app.windows[0].hwnd };
  const stable = [...app.windows].sort((a, b) => a.hwnd - b.hwnd);
  const front = stable.findIndex((w) => w.foreground && !w.minimized);
  if (front === -1) return { type: "focus", hwnd: app.windows[0].hwnd };
  return { type: "focus", hwnd: stable[(front + 1) % stable.length].hwnd };
}

/** Moves the pin at `from` to `to` (an index in the list without it). */
export function movePin(pins: Pin[], from: number, to: number): Pin[] {
  const next = [...pins];
  const [item] = next.splice(from, 1);
  if (!item) return pins;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Drops pin `from` onto pin `onto`: makes or extends a group. */
export function groupPins(pins: Pin[], from: number, onto: number, name?: string): Pin[] {
  if (from === onto) return pins;
  const a = pins[from];
  const b = pins[onto];
  if (!a || !b || isGroup(a)) return pins;
  const next = [...pins];
  if (isGroup(b)) {
    if (b.items.some((e) => e.id === a.id)) return pins;
    next[onto] = { ...b, items: [...b.items, a] };
  } else {
    next[onto] = { kind: "group", id: `group:${Date.now().toString(36)}`, name: name ?? "Apps", items: [b, a] };
  }
  next.splice(from, 1);
  return next;
}

export function hasPin(pins: Pin[], id: string): boolean {
  return pins.some((p) => (isGroup(p) ? p.items.some((e) => e.id === id) : p.id === id));
}

/** Removes an entry wherever it is; a group left with one app turns back into that app. */
export function removePin(pins: Pin[], id: string): Pin[] {
  const out: Pin[] = [];
  for (const p of pins) {
    if (isGroup(p)) {
      if (p.id === id) continue;
      const items = p.items.filter((e) => e.id !== id);
      if (items.length === 0) continue;
      out.push(items.length === 1 ? items[0] : { ...p, items });
    } else if (p.id !== id) out.push(p);
  }
  return out;
}
