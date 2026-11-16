import {
  Bell,
  BellOff,
  Bluetooth,
  BluetoothOff,
  Cable,
  Camera,
  CameraOff,
  Coffee,
  LayoutGrid,
  Leaf,
  Mic,
  MicOff,
  MonitorSmartphone,
  Plane,
  RadioTower,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { DisplayMode, ToggleState } from "../shared/types";

export type ToggleId =
  | "wifi"
  | "bluetooth"
  | "hotspot"
  | "airplane"
  | "ethernet"
  | "energySaver"
  | "dnd"
  | "keepAwake"
  | "desktopIcons"
  | "displayMode"
  | "microphone"
  | "camera";

export const ALL_TOGGLES: ToggleId[] = [
  "wifi",
  "bluetooth",
  "hotspot",
  "airplane",
  "ethernet",
  "energySaver",
  "dnd",
  "keepAwake",
  "desktopIcons",
  "displayMode",
  "microphone",
  "camera",
];

export const DEFAULT_TOGGLES: ToggleId[] = ["wifi", "bluetooth", "hotspot", "airplane"];

/** Stand-ins for default toggles this PC doesn't have (a desktop without Wi-Fi or Bluetooth). */
const FALLBACK_TOGGLES: ToggleId[] = ["ethernet", "dnd", "keepAwake", "energySaver", "microphone", "camera", "desktopIcons"];

/**
 * The toggles on the tile. A user's own choice is kept as it is; the default set is topped up
 * with switches this PC has, so a desktop doesn't get one lonely icon in a wide tile.
 */
export function tileToggles(chosen: ToggleId[] | undefined, s: ToggleState | undefined, count = DEFAULT_TOGGLES.length): ToggleId[] {
  const own = chosen?.length ? chosen : DEFAULT_TOGGLES;
  const isDefault = own.length === DEFAULT_TOGGLES.length && own.every((id, i) => id === DEFAULT_TOGGLES[i]);
  if (!s || !isDefault) return own;
  const have = own.filter((id) => viewOf(id, s, {}).available);
  for (const id of FALLBACK_TOGGLES) {
    if (have.length >= count) break;
    if (!have.includes(id) && viewOf(id, s, {}).available) have.push(id);
  }
  return have;
}

export const MODE_LABEL: Record<DisplayMode, string> = {
  internal: "PC screen only",
  clone: "Duplicate",
  extend: "Extend",
  external: "Second screen only",
};

export interface ToggleView {
  id: ToggleId;
  label: string;
  icon: LucideIcon;
  /** False when this PC doesn't have it. */
  available: boolean;
  /** Highlighted. */
  on: boolean;
  /** Short status under the label. */
  sub: string;
  /** Connected but something is off (Wi-Fi without internet). */
  warn?: boolean;
  /** Clicking opens Windows' own page or flyout instead of switching. */
  opensSettings?: boolean;
  /** Not an on/off switch (display mode). */
  action?: boolean;
}

export function viewOf(id: ToggleId, s: ToggleState | undefined, override: Partial<Record<ToggleId, boolean>>): ToggleView {
  const o = override[id];
  const pick = (real: boolean) => (o === undefined ? real : o);
  switch (id) {
    case "wifi": {
      const w = s?.wifi ?? null;
      const on = pick(!!w?.on);
      const sub = !w ? "Not on this PC" : !on ? "Off" : w.connected ? (w.online ? (w.ssid ?? "Connected") : `${w.ssid ?? "Wi-Fi"} · no internet`) : "Not connected";
      return { id, label: "Wi-Fi", icon: on ? Wifi : WifiOff, available: !!w, on, sub, warn: !!w && on && w.connected && !w.online };
    }
    case "bluetooth": {
      const on = pick(!!s?.bluetooth);
      return { id, label: "Bluetooth", icon: on ? Bluetooth : BluetoothOff, available: s?.bluetooth != null, on, sub: on ? "On" : "Off" };
    }
    case "hotspot": {
      const h = s?.hotspot ?? null;
      const on = pick(!!h?.on);
      const sub = !h?.capable ? "Not available" : on ? (h.clients === 1 ? "1 device" : `${h.clients} devices`) : "Off";
      return { id, label: "Mobile hotspot", icon: RadioTower, available: !!h?.capable, on, sub };
    }
    case "airplane": {
      const on = pick(!!s?.airplane);
      return { id, label: "Airplane mode", icon: Plane, available: s?.airplane != null, on, sub: on ? "On" : "Off", opensSettings: true };
    }
    case "ethernet": {
      const e = s?.ethernet ?? null;
      return { id, label: "Ethernet", icon: Cable, available: !!e, on: !!e?.connected, sub: e?.connected ? "Connected" : "Unplugged", opensSettings: true };
    }
    case "energySaver": {
      const on = pick(!!s?.energySaver);
      return { id, label: "Energy saver", icon: Leaf, available: s?.energySaver != null, on, sub: on ? "On" : "Off", opensSettings: true };
    }
    case "dnd": {
      const on = pick(!!s?.dnd);
      return { id, label: "Do not disturb", icon: on ? BellOff : Bell, available: !!s, on, sub: s?.dnd == null ? "Settings" : on ? "On" : "Off" };
    }
    case "keepAwake": {
      const on = pick(!!s?.keepAwake);
      return { id, label: "Keep awake", icon: Coffee, available: !!s, on, sub: on ? "Screen stays on" : "Off" };
    }
    case "desktopIcons": {
      const on = pick(!!s?.desktopIcons);
      return { id, label: "Desktop icons", icon: LayoutGrid, available: s?.desktopIcons != null, on, sub: on ? "Shown" : "Hidden" };
    }
    case "displayMode": {
      const m = s?.displayMode ?? null;
      return { id, label: "Display mode", icon: MonitorSmartphone, available: !!m, on: false, sub: m ? MODE_LABEL[m] : "", action: true };
    }
    case "microphone": {
      const on = pick(!!s?.microphone);
      return { id, label: "Microphone", icon: on ? Mic : MicOff, available: s?.microphone != null, on, sub: on ? "On" : "Muted" };
    }
    case "camera": {
      const on = pick(!!s?.camera);
      return { id, label: "Camera", icon: on ? Camera : CameraOff, available: s?.camera != null, on, sub: on ? "Apps may use it" : "Blocked" };
    }
  }
}
