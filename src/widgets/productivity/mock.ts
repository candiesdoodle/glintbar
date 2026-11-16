/** Browser-preview data for the productivity slice (Screen Time, WhatsApp). */
import { mockService } from "../../core/mock";
import type { DaySummary, DayTotal, Segment } from "./screentime/types";
import { localDate } from "./screentime/types";

const APPS: Array<{ key: string; name: string; weight: number }> = [
  { key: "code.exe", name: "Visual Studio Code", weight: 30 },
  { key: "chrome.exe", name: "Google Chrome", weight: 26 },
  { key: "slack.exe", name: "Slack", weight: 10 },
  { key: "figma.exe", name: "Figma", weight: 8 },
  { key: "windowsterminal.exe", name: "Terminal", weight: 7 },
  { key: "outlook.exe", name: "Outlook", weight: 5 },
  { key: "spotify.exe", name: "Spotify", weight: 4 },
  { key: "explorer.exe", name: "File Explorer", weight: 3 },
  { key: "discord.exe", name: "Discord", weight: 3 },
  { key: "zoom.exe", name: "Zoom", weight: 4 },
];
const NAMES = new Map(APPS.map((a) => [a.key, a.name]));

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick(r: () => number): string {
  const total = APPS.reduce((a, x) => a + x.weight, 0);
  let v = r() * total;
  for (const a of APPS) {
    v -= a.weight;
    if (v <= 0) return a.key;
  }
  return APPS[0].key;
}

function segmentsFor(date: string): Segment[] {
  const [y, m, d] = date.split("-").map(Number);
  const r = rng(y * 10000 + m * 100 + d);
  const dayStart = new Date(y, m - 1, d).getTime();
  const isToday = date === localDate();
  const limit = isToday ? Math.floor((Date.now() - dayStart) / 1000) : 86_400;
  const weekend = [0, 6].includes(new Date(y, m - 1, d).getDay());
  const out: Segment[] = [];
  let t = (weekend ? 10 : 8) * 3600 + Math.floor(r() * 3600);
  const end = (weekend ? 17 : 19) * 3600 + Math.floor(r() * 7200);
  while (t < Math.min(end, limit)) {
    if (r() < 0.06) t += 600 + Math.floor(r() * 2400); // a break
    const app = pick(r);
    const secs = Math.floor((app === "code.exe" || app === "figma.exe" ? 600 : 120) + r() * (app === "code.exe" ? 2400 : 900));
    const s = Math.min(secs, Math.min(end, limit) - t);
    if (s > 0) out.push({ start: t, secs: s, app });
    t += s;
    if (t > 12.5 * 3600 && t < 13.2 * 3600) t = 13.2 * 3600; // lunch
  }
  return out;
}

function summarize(date: string, segs: Segment[], withSegments: boolean): DaySummary {
  const hours = Array(24).fill(0);
  const per = new Map<string, number>();
  let longest = { secs: 0, app: null as string | null };
  let switches = 0;
  segs.forEach((s, i) => {
    per.set(s.app, (per.get(s.app) ?? 0) + s.secs);
    if (s.secs > longest.secs) longest = { secs: s.secs, app: NAMES.get(s.app) ?? s.app };
    if (i && segs[i - 1].app !== s.app) switches++;
    let t = s.start;
    const e = s.start + s.secs;
    while (t < e) {
      const h = Math.floor(t / 3600);
      const piece = Math.min((h + 1) * 3600, e) - t;
      hours[h] += piece;
      t += piece;
    }
  });
  const apps = [...per.entries()].map(([key, secs]) => ({ key, name: NAMES.get(key) ?? key, secs })).sort((a, b) => b.secs - a.secs);
  const chrome = per.get("chrome.exe") ?? 0;
  const sitesOn = Boolean((JSON.parse(localStorage.getItem("glintbar.store") ?? "{}")["productivity.screentime"] ?? {}).sites);
  return {
    date,
    totalSecs: hours.reduce((a, b) => a + b, 0),
    hours,
    apps,
    sites: sitesOn
      ? [
          { name: "GitHub", secs: Math.round(chrome * 0.34) },
          { name: "YouTube", secs: Math.round(chrome * 0.22) },
          { name: "Gmail", secs: Math.round(chrome * 0.16) },
          { name: "Stack Overflow", secs: Math.round(chrome * 0.12) },
          { name: "Other sites", secs: Math.round(chrome * 0.16) },
        ]
      : [],
    longestFocusSecs: longest.secs,
    longestFocusApp: longest.app,
    switches,
    firstActive: segs[0]?.start ?? null,
    lastActive: segs.length ? segs[segs.length - 1].start + segs[segs.length - 1].secs : null,
    segments: withSegments ? segs : null,
    tracking: true,
    sitesOn,
  };
}

mockService("productivity", {
  screentime_day: ({ date, segments }: { date?: string; segments?: boolean }) => {
    const d = date ?? localDate();
    return summarize(d, segmentsFor(d), Boolean(segments));
  },
  screentime_days: ({ days }: { days?: number }): DayTotal[] => {
    const n = Math.max(1, Math.min(90, days ?? 7));
    const out: DayTotal[] = [];
    for (let back = n - 1; back >= 0; back--) {
      const d = new Date();
      d.setDate(d.getDate() - back);
      const date = localDate(d);
      const s = summarize(date, segmentsFor(date), false);
      out.push({ date, totalSecs: s.totalSecs, apps: s.apps.slice(0, 12) });
    }
    return out;
  },
  screentime_status: () => ({ tracking: true, sitesOn: false, paused: false, daysKept: 23 }),
  screentime_forget_sites: () => undefined,
  whatsapp_status: () => {
    const now = Date.now();
    return {
      access: "allowed",
      unread: 7,
      lastSender: "Mum",
      lastAt: now - 4 * 60_000,
      chats: [
        { name: "Mum", count: 2, lastAt: now - 4 * 60_000 },
        { name: "Design team", count: 4, lastAt: now - 22 * 60_000 },
        { name: "Alex Rivera", count: 1, lastAt: now - 75 * 60_000 },
      ],
      message: null,
    };
  },
  whatsapp_request_access: () => ({ access: "allowed", unread: 0, lastSender: null, lastAt: null, chats: [], message: null }),
});
