/** Mirrors src-tauri/src/services/apps/model.rs (serde camelCase). */

export type EntryKind = "app" | "folder" | "file" | "url";

/** Something that can sit on the dock: an app, a folder, a file or a link. */
export interface AppEntry {
  /** "aumid:<id>", "exe:<path>" or "path:<path>" (lowercase); matches windows to pins. */
  id: string;
  name: string;
  kind: EntryKind;
  /** What opening it runs: a shortcut, program, folder, file or "shell:AppsFolder\\<id>". */
  target: string;
  args?: string | null;
  aumid?: string | null;
  /** Lowercase program path. */
  exe?: string | null;
  /** Icon source for apps.icon. */
  icon: string;
}

/** Apps dropped on one another (an iPhone-style group). */
export interface PinGroup {
  kind: "group";
  id: string;
  name: string;
  items: AppEntry[];
}

export type Pin = AppEntry | PinGroup;

export function isGroup(p: Pin): p is PinGroup {
  return p.kind === "group";
}

export interface WindowInfo {
  hwnd: number;
  pid: number;
  title: string;
  exe?: string | null;
  aumid?: string | null;
  appName: string;
  minimized: boolean;
  foreground: boolean;
  flashing: boolean;
  hung: boolean;
}

export interface JumpItem {
  title: string;
  target: string;
  args?: string | null;
  icon: string;
}

export interface JumpList {
  tasks: JumpItem[];
  pinned: JumpItem[];
  recent: JumpItem[];
}

export interface RecycleInfo {
  count: number;
  bytes: number;
}

export interface Drive {
  root: string;
  letter: string;
  label: string;
  fs: string;
  kind: "fixed" | "removable" | "network" | "cdrom" | "other";
  total: number;
  free: number;
  system: boolean;
}

export interface FolderSize {
  name: string;
  path: string;
  bytes: number;
  approx: boolean;
}

export interface FolderEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  icon: string;
}

export interface RecentItem {
  name: string;
  target: string;
  kind: "file" | "folder" | "app";
  at: number;
  icon: string;
}

export interface Recent {
  files: RecentItem[];
  apps: RecentItem[];
}

export interface Capture {
  path: string | null;
  width: number;
  height: number;
  copied: boolean;
  thumb: string | null;
}
