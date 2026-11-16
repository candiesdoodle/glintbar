import { useMemo } from "react";
import { useService } from "../../../core/backend";
import { sampleItems } from "../calendar/sample";
import { useCalendarItems } from "../calendar/store";
import { focusOn, sampleHistory, usePomodoro } from "../pomodoro/store";
import type { DaySummary } from "../screentime/types";
import { appKind, KIND_META, type AppKind } from "../shared/apps";
import { startOfDay } from "../shared/time";
import { guessLocation, sunTimes } from "./sun";

export type TimelineConfig = { lat: number | null; lon: number | null; place: string };

export interface Block {
  /** Fractions of the day, 0-1. */
  from: number;
  to: number;
  color: string;
  label: string;
}

export interface DayLine {
  apps: Block[];
  focus: Block[];
  meetings: Block[];
  sunrise: number | null;
  sunset: number | null;
  byKind: Array<{ kind: AppKind; secs: number }>;
  totalSecs: number;
  focusSecs: number;
  meetingSecs: number;
  place: string;
  loaded: boolean;
}

const DAY = 86_400_000;

export function useDayLine(config: TimelineConfig, isSample: boolean, now: number): DayLine {
  const st = useService<DaySummary>("productivity", "screentime_day", { segments: true }, { refreshMs: 60_000 });
  const history = usePomodoro((s) => s.history);
  const { items } = useCalendarItems();
  return useMemo(() => {
    const day = startOfDay(now);
    const frac = (t: number) => Math.min(1, Math.max(0, (t - day) / DAY));
    const appsByKind = new Map<AppKind, number>();
    const apps: Block[] = [];
    for (const s of st.data?.segments ?? []) {
      const kind = appKind(s.app);
      appsByKind.set(kind, (appsByKind.get(kind) ?? 0) + s.secs);
      const from = s.start / 86400;
      const to = (s.start + s.secs) / 86400;
      const last = apps[apps.length - 1];
      // Merge neighbours of the same kind (keeps the DOM small).
      if (last && last.label === kind && from - last.to < 180 / 86400) last.to = to;
      else apps.push({ from, to, color: KIND_META[kind].color, label: kind });
    }
    const sessions = focusOn(isSample ? sampleHistory(now) : history, day);
    const focus = sessions.map((h) => ({ from: frac(h.start), to: frac(Math.min(h.end, now)), color: "var(--g-bad)", label: "Focus" }));
    const meetingItems = (isSample ? sampleItems(now) : items).filter((i) => !i.allDay && (i.kind === "meeting" || i.kind === "event") && i.start < day + DAY && (i.end ?? i.start) > day);
    const meetings = meetingItems.map((i) => ({ from: frac(i.start), to: frac(i.end ?? i.start + 30 * 60_000), color: i.color ?? "#4f8cff", label: i.title }));
    const loc = config.lat !== null && config.lon !== null ? { lat: config.lat, lon: config.lon, place: config.place } : guessLocation();
    const sun = sunTimes(new Date(day), loc.lat, loc.lon);
    return {
      apps,
      focus,
      meetings,
      sunrise: sun.rise,
      sunset: sun.set,
      byKind: [...appsByKind.entries()].map(([kind, secs]) => ({ kind, secs })).sort((a, b) => b.secs - a.secs),
      totalSecs: st.data?.totalSecs ?? 0,
      focusSecs: sessions.reduce((a, h) => a + (Math.min(h.end, now) - Math.max(h.start, day)) / 1000, 0),
      meetingSecs: meetingItems.reduce((a, i) => a + Math.max(0, Math.min(i.end ?? i.start, now) - Math.max(i.start, day)) / 1000, 0),
      place: loc.place,
      loaded: Boolean(st.data),
    };
  }, [st.data, history, items, config.lat, config.lon, config.place, isSample, now]);
}
