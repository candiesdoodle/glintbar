/** Built-in commands, and matching what was typed against them and the installed apps. */
import type { AppEntry } from "../types";

export interface Command {
  id: string;
  title: string;
  /** Extra words that find it. */
  words: string[];
  /** Lucide icon name key (see CommandIcon). */
  icon: string;
  /** What it runs. */
  run: { open: string } | { shell: string } | { call: [service: string, method: string] };
  /** Ask once more before running (shut down, restart...). */
  confirm?: boolean;
}

const open = (target: string) => ({ open: target });

export const COMMANDS: Command[] = [
  { id: "lock", title: "Lock", words: ["lock", "away"], icon: "lock", run: { shell: "rundll32.exe user32.dll,LockWorkStation" } },
  { id: "sleep", title: "Sleep", words: ["sleep", "suspend"], icon: "moon", run: { shell: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0" }, confirm: true },
  { id: "restart", title: "Restart", words: ["restart", "reboot"], icon: "rotate", run: { shell: "shutdown /r /t 0" }, confirm: true },
  { id: "shutdown", title: "Shut down", words: ["shutdown", "shut down", "power off", "turn off"], icon: "power", run: { shell: "shutdown /s /t 0" }, confirm: true },
  { id: "signout", title: "Sign out", words: ["sign out", "log off", "logout"], icon: "logout", run: { shell: "shutdown /l" }, confirm: true },
  { id: "settings", title: "Settings", words: ["settings", "preferences", "control"], icon: "settings", run: open("ms-settings:") },
  { id: "wifi", title: "Wi-Fi settings", words: ["wifi", "wi-fi", "wireless", "network"], icon: "wifi", run: open("ms-settings:network-wifi") },
  { id: "bluetooth", title: "Bluetooth & devices", words: ["bluetooth", "devices", "pair"], icon: "bluetooth", run: open("ms-settings:bluetooth") },
  { id: "display", title: "Display settings", words: ["display", "screen", "resolution", "brightness", "monitor"], icon: "monitor", run: open("ms-settings:display") },
  { id: "sound", title: "Sound settings", words: ["sound", "audio", "volume", "speakers", "microphone"], icon: "volume", run: open("ms-settings:sound") },
  { id: "update", title: "Windows Update", words: ["update", "updates", "windows update"], icon: "download", run: open("ms-settings:windowsupdate") },
  { id: "apps", title: "Installed apps", words: ["apps", "uninstall", "programs", "installed"], icon: "grid", run: open("ms-settings:appsfeatures") },
  { id: "storage", title: "Storage settings", words: ["storage", "disk", "space", "cleanup"], icon: "drive", run: open("ms-settings:storagesense") },
  { id: "taskmgr", title: "Task Manager", words: ["task manager", "taskmgr", "processes", "kill"], icon: "activity", run: open("taskmgr.exe") },
  { id: "control", title: "Control Panel", words: ["control panel"], icon: "sliders", run: open("control.exe") },
  { id: "downloads", title: "Downloads", words: ["downloads", "download folder"], icon: "folder", run: open("shell:Downloads") },
  { id: "documents", title: "Documents", words: ["documents", "docs"], icon: "folder", run: open("shell:Personal") },
  { id: "desktop", title: "Desktop folder", words: ["desktop folder"], icon: "folder", run: open("shell:Desktop") },
  { id: "bin", title: "Recycle Bin", words: ["recycle bin", "trash", "bin"], icon: "trash", run: open("shell:RecycleBinFolder") },
  { id: "snip", title: "Screenshot a region", words: ["screenshot", "snip", "capture", "screen clip"], icon: "crop", run: { call: ["apps", "capture_region"] } },
  { id: "start", title: "Start menu", words: ["start", "start menu"], icon: "grid", run: { call: ["apps", "start_menu"] } },
];

export type Match = { kind: "command"; command: Command; score: number } | { kind: "app"; app: AppEntry; score: number };

/** 3 = starts with it, 2 = a word starts with it, 1 = contains it, 0 = no. */
function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 2;
  if (q.length >= 3 && t.includes(q)) return 1;
  return 0;
}

export function findCommands(query: string, apps: AppEntry[], limit = 6): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Match[] = [];
  for (const c of COMMANDS) {
    const s = Math.max(score(c.title, q), ...c.words.map((w) => score(w, q)));
    if (s > 0) out.push({ kind: "command", command: c, score: s + 0.5 });
  }
  for (const a of apps) {
    const s = score(a.name, q);
    if (s > 0) out.push({ kind: "app", app: a, score: s + (a.name.length < 14 ? 0.2 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
