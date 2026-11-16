/**
 * In-dock alerts (toasts). Anything can call `notify({...})`; during quiet hours alerts are held
 * and shown together when quiet hours end. The sound the user picked plays for the alert kinds
 * they chose (Settings > Automations).
 */
import { create } from "zustand";
import type { LucideIcon } from "lucide-react";
import { cancelScheduled, scheduleAt } from "./scheduler";
import { inQuietHours, quietEndsAt, useAutomations, type AlertKind } from "./settings";
import { playSound } from "./sounds";

export interface AlertAction {
  label: string;
  run: () => void;
  primary?: boolean;
}

export interface AlertInput {
  kind: AlertKind;
  title: string;
  body?: string;
  icon?: LucideIcon;
  actions?: AlertAction[];
  /** Stays until dismissed (a finished timer). Others go after a few seconds. */
  sticky?: boolean;
  /** An alert with the same key replaces the previous one. */
  key?: string;
  /** Never plays a sound. */
  silent?: boolean;
}

export interface Alert extends AlertInput {
  id: string;
  at: number;
}

interface AlertState {
  shown: Alert[];
  held: Alert[];
}

export const useAlerts = create<AlertState>()(() => ({ shown: [], held: [] }));

const MAX_SHOWN = 3;
let seq = 0;

function sound(kind: AlertKind, silent?: boolean) {
  if (silent) return;
  const s = useAutomations.getState();
  if (s.sound === "none" || !s.soundFor[kind]) return;
  playSound(s.sound, s.volume);
}

function show(list: Alert[]) {
  useAlerts.setState((s) => {
    let shown = s.shown;
    for (const a of list) {
      shown = a.key ? shown.filter((x) => x.key !== a.key) : shown;
      shown = [...shown, a];
    }
    return { shown: shown.slice(-MAX_SHOWN) };
  });
}

/** Shows an alert now, or holds it during quiet hours. Returns its id. */
export function notify(input: AlertInput): string {
  const alert: Alert = { ...input, id: `a${Date.now().toString(36)}${(seq++).toString(36)}`, at: Date.now() };
  const quiet = useAutomations.getState().quiet;
  if (inQuietHours(quiet)) {
    useAlerts.setState((s) => ({ held: [...(alert.key ? s.held.filter((x) => x.key !== alert.key) : s.held), alert] }));
    const end = quietEndsAt(quiet);
    if (end) scheduleAt("alerts.release", end + 1000, releaseHeld);
    return alert.id;
  }
  show([alert]);
  sound(alert.kind, alert.silent);
  return alert.id;
}

/** Shows what quiet hours held back (the newest few, plus a count of the rest). */
export function releaseHeld(): void {
  cancelScheduled("alerts.release");
  const held = useAlerts.getState().held;
  if (!held.length) return;
  if (inQuietHours(useAutomations.getState().quiet)) {
    const end = quietEndsAt(useAutomations.getState().quiet);
    if (end) scheduleAt("alerts.release", end + 1000, releaseHeld);
    return;
  }
  useAlerts.setState({ held: [] });
  const recent = held.slice(-(MAX_SHOWN - 1));
  const extra = held.length - recent.length;
  const list: Alert[] = [...recent];
  if (extra > 0) {
    list.unshift({ id: `held${Date.now()}`, at: Date.now(), kind: "automation", title: `${extra} more alert${extra === 1 ? "" : "s"} held in quiet hours`, body: held.slice(0, extra).map((a) => a.title).join(" · ") });
  }
  show(list);
  const loud = held.find((a) => !a.silent);
  if (loud) sound(loud.kind);
}

export function dismissAlert(id: string): void {
  useAlerts.setState((s) => ({ shown: s.shown.filter((a) => a.id !== id) }));
}

export function dismissKey(key: string): void {
  useAlerts.setState((s) => ({ shown: s.shown.filter((a) => a.key !== key), held: s.held.filter((a) => a.key !== key) }));
}
