import { describe, expect, it } from "vitest";
import type { AppEntry, Pin, WindowInfo } from "../types";
import { buildDockApps, clickAction, entryMatches, groupPins, movePin, parseBadge, removePin } from "./grouping";

const entry = (id: string, extra: Partial<AppEntry> = {}): AppEntry => ({ id, name: id, kind: "app", target: id, icon: id, ...extra });
const win = (hwnd: number, extra: Partial<WindowInfo> = {}): WindowInfo => ({
  hwnd,
  pid: hwnd,
  title: "w",
  appName: "App",
  minimized: false,
  foreground: false,
  flashing: false,
  hung: false,
  ...extra,
});

describe("apps grouping", () => {
  it("matches by app id, else by program", () => {
    const chrome = entry("chrome", { aumid: "Chrome", exe: "c:\\chrome.exe" });
    expect(entryMatches(chrome, win(1, { aumid: "chrome", exe: "c:\\chrome.exe" }))).toBe(true);
    // An installed web app runs from chrome.exe but has its own id.
    expect(entryMatches(chrome, win(2, { aumid: "Chrome._crx_abc", exe: "c:\\chrome.exe" }))).toBe(false);
    expect(entryMatches(chrome, win(3, { exe: "C:\\Chrome.exe" }))).toBe(true);
  });

  it("puts one icon per app, pins first", () => {
    const pins: Pin[] = [entry("code", { exe: "code.exe" }), entry("edge", { aumid: "MSEdge" })];
    const wins = [win(10, { exe: "code.exe", foreground: true }), win(11, { aumid: "Spotify" }), win(12, { aumid: "Spotify" })];
    const apps = buildDockApps(pins, wins, { showRunning: true });
    expect(apps.map((a) => a.key)).toEqual(["code", "edge", "aumid:spotify"]);
    expect(apps[0].active).toBe(true);
    expect(apps[2].windows.length).toBe(2);
    expect(buildDockApps(pins, wins, { showRunning: false }).length).toBe(2);
  });

  it("reads badges from titles", () => {
    expect(parseBadge("(3) Inbox - Outlook")).toBe(3);
    expect(parseBadge("Telegram (12)")).toBe(12);
    expect(parseBadge("[5] Chat")).toBe(5);
    expect(parseBadge("* Slack - Team")).toBe(0);
    expect(parseBadge("Notes (draft)")).toBe(null);
  });

  it("clicks like the taskbar", () => {
    const base = { key: "k", name: "n", icon: "", kind: "app" as const, active: false, flashing: false, hung: false, badge: null };
    expect(clickAction({ ...base, windows: [] })).toEqual({ type: "launch" });
    expect(clickAction({ ...base, kind: "folder", windows: [] })).toEqual({ type: "stack" });
    expect(clickAction({ ...base, windows: [win(5)] })).toEqual({ type: "toggle", hwnd: 5 });
    expect(clickAction({ ...base, windows: [win(9), win(4, { foreground: true })] })).toEqual({ type: "focus", hwnd: 9 });
    expect(clickAction({ ...base, windows: [win(9), win(4)] })).toEqual({ type: "focus", hwnd: 9 });
  });

  it("groups, moves and removes pins", () => {
    const pins: Pin[] = [entry("a"), entry("b"), entry("c")];
    const grouped = groupPins(pins, 0, 1, "Chat");
    expect(grouped.length).toBe(2);
    expect(grouped[0].kind).toBe("group");
    expect(movePin(pins, 0, 2).map((p) => p.id)).toEqual(["b", "c", "a"]);
    const ungrouped = removePin(grouped, "a");
    expect(ungrouped.map((p) => p.id)).toEqual(["b", "c"]);
  });
});
