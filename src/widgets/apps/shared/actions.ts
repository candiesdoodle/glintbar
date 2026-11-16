/** Calls the apps service for the things a dock icon does. Errors are logged, not thrown. */
import { call } from "../../../core/backend";
import type { AppEntry, WindowInfo } from "../types";
import { clickAction, type DockApp } from "./grouping";

function quiet(p: Promise<unknown>) {
  p.catch((e) => console.warn("apps:", e));
}

export function launchEntry(e: Pick<AppEntry, "target" | "args">, opts: { admin?: boolean } = {}): void {
  quiet(call("apps", "launch", { target: e.target, args: e.args ?? undefined, admin: !!opts.admin }));
}

export function openTarget(target: string, args?: string | null): void {
  quiet(call("apps", "launch", { target, args: args ?? undefined }));
}

export function focusWindow(w: Pick<WindowInfo, "hwnd">): void {
  quiet(call("apps", "focus", { hwnd: w.hwnd }));
}

export function closeWindow(w: Pick<WindowInfo, "hwnd">): void {
  quiet(call("apps", "close", { hwnd: w.hwnd }));
}

export function endTask(wins: WindowInfo[]): void {
  for (const pid of new Set(wins.map((w) => w.pid))) quiet(call("apps", "end_task", { pid }));
}

export function reveal(path: string): void {
  quiet(call("apps", "reveal", { path }));
}

/** Where a running app can be started again from. */
export function relaunchTarget(app: DockApp): Pick<AppEntry, "target" | "args"> | null {
  if (app.pin && app.pin.kind !== "folder" && app.pin.kind !== "file") return app.pin;
  const w = app.windows[0];
  if (!w) return null;
  if (w.aumid) return { target: `aumid:${w.aumid}` };
  if (w.exe) return { target: w.exe };
  return null;
}

/**
 * A left click. Returns "stack" / "group" when the caller should open that panel instead.
 */
export function activate(app: DockApp): "stack" | "group" | null {
  const a = clickAction(app);
  switch (a.type) {
    case "stack":
    case "group":
      return a.type;
    case "open":
    case "launch":
      if (app.pin) launchEntry(app.pin);
      return null;
    case "toggle":
      quiet(call("apps", "toggle", { hwnd: a.hwnd }));
      return null;
    case "focus":
      quiet(call("apps", "focus", { hwnd: a.hwnd }));
      return null;
  }
}
