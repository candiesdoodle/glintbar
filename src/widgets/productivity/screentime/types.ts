/** Mirrors src-tauri/src/services/productivity/screentime.rs (serde camelCase). */
export interface AppTime {
  /** Lower-case exe name: "chrome.exe". */
  key: string;
  name: string;
  secs: number;
}

export interface SiteTime {
  name: string;
  secs: number;
}

export interface Segment {
  /** Second of the day. */
  start: number;
  secs: number;
  app: string;
}

export interface DaySummary {
  date: string;
  totalSecs: number;
  hours: number[];
  apps: AppTime[];
  sites: SiteTime[];
  longestFocusSecs: number;
  longestFocusApp: string | null;
  switches: number;
  firstActive: number | null;
  lastActive: number | null;
  segments: Segment[] | null;
  tracking: boolean;
  sitesOn: boolean;
}

export interface DayTotal {
  date: string;
  totalSecs: number;
  apps: AppTime[];
}

export interface ScreenTimeStatus {
  tracking: boolean;
  sitesOn: boolean;
  paused: boolean;
  daysKept: number;
}

/** Store key Rust reads every sample. */
export const OPTIONS_KEY = "productivity.screentime";
export interface ScreenTimeOptions {
  sites: boolean;
  paused: boolean;
  /** Count even with no Screen Time / Day Timeline tile on the dock (off: only while one is). */
  always: boolean;
}
export const DEFAULT_OPTIONS: ScreenTimeOptions = { sites: false, paused: false, always: false };

export type ScreenTimeConfig = {
  /** App key whose time the tile shows instead of the total. */
  pinned: string | null;
};

export function localDate(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
