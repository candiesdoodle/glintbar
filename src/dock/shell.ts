/**
 * The dock's side of the shell service: tells Rust where the strip is and what it may do
 * (`set_dock`), and follows what Rust decides for this window - auto-hidden, hidden under a
 * full-screen app, moved to another edge or screen, closing.
 *
 * Settings come from two stores: "dock" (src/dock/layout.ts: edge, size, auto-hide, ...) and
 * "settings.dock" (src/settings/keys.ts: displays, lock, taskbar mode, show on desktop).
 */
import { useEffect } from "react";
import { create } from "zustand";
import { call, on } from "../core/backend";
import { screenFitMode, useDockPrefs, type DockPrefs } from "../settings/keys";
import { dockActions, stripThickness, useDock, type DockState, type Edge } from "./layout";
import { ui, useDockUi } from "./ui";
import { WINDOW_LABEL, isMainWindow } from "../core/windowLabel";
import { KEYNAV_FALLBACKS, KEYNAV_HOTKEY } from "./keyNav";
import { applyFit, fitMinFor } from "./fit";

export type Visibility = "shown" | "autohidden" | "suppressed";

interface ShellState {
  visibility: Visibility;
  /** Device name of this window's monitor ("" until known). */
  monitor: string;
  /** Rust is closing this window (Displays changed): render nothing so widgets unsubscribe. */
  closing: boolean;
}

export const useShell = create<ShellState>()(() => ({ visibility: "shown", monitor: "", closing: false }));

/** Events older than this are replays of something that already happened. */
const STALE_MS = 3000;

interface Labelled {
  label?: string;
  at?: number;
}

function forMe(p: Labelled | null | undefined): boolean {
  if (!p) return false;
  if (p.label !== undefined && p.label !== WINDOW_LABEL) return false;
  return p.at === undefined || Date.now() - p.at < STALE_MS;
}

export type TaskbarChoice = "hidden" | "autohide" | "normal";

/** Older layouts only know `hideTaskbar`; Settings > Dock writes both. */
export function taskbarChoice(hideTaskbar: boolean, mode: DockPrefs["taskbarMode"]): TaskbarChoice {
  if (mode === "leave" || (!hideTaskbar && mode === "hidden")) return "normal";
  return mode;
}

/**
 * What `shell.set_dock` gets. Pure, exported for tests. The thickness is at the set size: Rust
 * scales each dock's strip by that dock's screen fit (never below `fitMin`) and tells the page.
 */
export function geometryFor(d: DockState, p: DockPrefs) {
  return {
    edge: d.edge,
    thickness: stripThickness(d),
    reserveSpace: d.reserveSpace,
    hideTaskbar: taskbarChoice(d.hideTaskbar, p.taskbarMode) === "hidden",
    taskbar: taskbarChoice(d.hideTaskbar, p.taskbarMode),
    autoHide: d.autoHide,
    showOnDesktop: p.showOnDesktop,
    displays: p.displays,
    monitor: d.monitor,
    screenFit: screenFitMode(p.screenFit),
    screenFitRef: Number.isFinite(p.screenFitRef) && p.screenFitRef > 0 ? p.screenFitRef : 0,
    fitMin: fitMinFor(d),
  };
}

/** True while widgets may be moved: unlocked, or the Widgets picker is open. */
export function useCanArrange(): boolean {
  const locked = useDockPrefs((p) => p.lockDock);
  const picker = useDockUi((s) => s.panel === "widgets");
  return !locked || picker;
}

export function isLocked(): boolean {
  return useDockPrefs.getState().lockDock;
}

export function toggleLock(): void {
  useDockPrefs.setState((p) => ({ lockDock: !p.lockDock }));
}

/** Sends the geometry (debounced while a slider is dragged). One window is enough: all docks share it. */
export function useGeometrySync(): void {
  const d = useDock();
  const p = useDockPrefs();
  const geo = geometryFor(d, p);
  const key = JSON.stringify(geo);
  useEffect(() => {
    if (!isMainWindow) return;
    const t = setTimeout(() => {
      call("shell", "set_dock", JSON.parse(key)).catch((e) => console.warn("set_dock", e));
    }, 60);
    return () => clearTimeout(t);
  }, [key]);
}

let hoverSent: boolean | undefined;
/** Pointer over the dock (auto-hide keeps it up). Deduplicated. */
export function reportHover(inside: boolean): void {
  if (hoverSent === inside) return;
  hoverSent = inside;
  call("shell", "set_hover", { label: WINDOW_LABEL, inside }).catch(() => {});
}

/** The bar is being dragged by an empty spot: Rust moves the window and snaps it on release. */
export function beginDockDrag(): void {
  call("shell", "begin_drag", { label: WINDOW_LABEL }).catch(() => {});
}

function applyVisibility(v: Visibility) {
  useShell.setState({ visibility: v });
  const hidden = v !== "shown";
  if (useDockUi.getState().hidden !== hidden) useDockUi.setState({ hidden });
  if (hidden) {
    hoverSent = undefined;
    if (v === "suppressed") ui.closeAll();
  }
}

/** Live link to Rust for this window. Mount once (Dock). */
export function useShellBridge(): void {
  useEffect(() => {
    let alive = true;
    call<{ monitor: string; visibility: Visibility; fit?: number; screenHeight?: number; fitSeq?: number }>("shell", "window_info", { label: WINDOW_LABEL })
      .then((info) => {
        if (!alive || !info) return;
        useShell.setState({ monitor: info.monitor ?? "" });
        if (info.visibility) applyVisibility(info.visibility);
        applyFit({ fit: info.fit, screenHeight: info.screenHeight, seq: info.fitSeq });
      })
      .catch(() => {});
    const offs = [
      on<{ label: string; state: Visibility }>("shell", "visibility", (p) => {
        if (p && p.label === WINDOW_LABEL) applyVisibility(p.state);
      }),
      // This dock's screen fit changed (its monitor, the display or the setting). Only the drawing
      // follows it: the geometry sent to Rust does not depend on it, so nothing is sent back.
      on<{ label: string; fit: number; screenHeight: number; seq: number }>("shell", "fit", (p) => {
        if (p && p.label === WINDOW_LABEL) applyFit(p);
      }),
      on<{ edge: Edge; monitor: string; at: number }>("shell", "placement", (p) => {
        if (!isMainWindow || !p || Date.now() - p.at > STALE_MS) return;
        const d = useDock.getState();
        if (d.edge !== p.edge || d.monitor !== p.monitor) dockActions.update({ edge: p.edge, monitor: p.monitor });
      }),
      // Clicks in other apps and Esc while the dock has no keyboard focus (Rust low-level hooks,
      // installed only while a popover is open). Same close paths as inside the page.
      on<Labelled>("shell", "outside-click", (p) => {
        if (forMe(p)) ui.closeAll();
      }),
      on<Labelled>("shell", "escape", (p) => {
        if (forMe(p)) ui.closeTop();
      }),
      on<Labelled>("shell", "closing", (p) => {
        if (!forMe(p)) return;
        useShell.setState({ closing: true });
        // Give React a frame to unmount every widget (they unsubscribe their topics), then tell Rust.
        setTimeout(() => call("shell", "close_ready", { label: WINDOW_LABEL }).catch(() => {}), 120);
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, []);
}

/** Global hotkeys this dock asks for. Ids are what `svc://shell/hotkey` reports. */
export const HOTKEYS = [{ id: "todo", keys: "Alt+T" }, KEYNAV_HOTKEY];

/** Other keys to try, in order, when a hotkey is already taken by another app. */
const HOTKEY_FALLBACKS: Record<string, string[]> = { [KEYNAV_HOTKEY.id]: KEYNAV_FALLBACKS };

type HotkeyResult = { id: string; keys?: string; ok: boolean; error?: string | null };

/** Registers the global hotkeys once (main window only; Rust routes them to the right dock). */
export function useHotkeys(): void {
  useEffect(() => {
    if (!isMainWindow) return;
    let alive = true;
    const register = async () => {
      let wanted = HOTKEYS.map((h) => ({ ...h }));
      const tried: Record<string, number> = {};
      // hotkeys_set replaces the whole set, so a taken key is retried with its fallback.
      for (let round = 0; round < 4 && alive; round++) {
        const res = await call<HotkeyResult[]>("shell", "hotkeys_set", { hotkeys: wanted });
        let retry = false;
        for (const r of res ?? []) {
          if (r.ok) continue;
          const alts = HOTKEY_FALLBACKS[r.id] ?? [];
          const i = tried[r.id] ?? 0;
          if (i < alts.length) {
            tried[r.id] = i + 1;
            const from = wanted.find((h) => h.id === r.id)?.keys;
            console.info(`hotkey ${r.id}: ${from} is taken by another app; trying ${alts[i]}`);
            wanted = wanted.map((h) => (h.id === r.id ? { ...h, keys: alts[i] } : h));
            retry = true;
          } else {
            console.warn(`hotkey ${r.id}: ${r.error ?? "unavailable"}`);
          }
        }
        if (!retry) return;
      }
    };
    register().catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
}
