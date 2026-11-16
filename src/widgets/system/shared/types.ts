/** Mirrors src-tauri/src/services/system/*.rs (serde camelCase). */

export interface MemorySample {
  usage: number;
  used: number;
  total: number;
  available: number;
  commitUsed: number;
  commitLimit: number;
  /** Oldest first, one every 2 s, up to 60. */
  history: number[];
  at: number;
}

export interface AppUsage {
  name: string;
  exe: string;
  /** 0-100 of the whole machine. */
  cpu: number;
  /** Private working set, bytes. */
  memory: number;
  processes: number;
}

export interface ProcSample {
  cpu: AppUsage[];
  ram: AppUsage[];
  processCount: number;
  at: number;
}

export interface NetSample {
  /** Bytes per second. */
  down: number;
  up: number;
  downHistory: number[];
  upHistory: number[];
  kind: "wifi" | "ethernet" | "cellular" | "other" | "none";
  at: number;
}

export interface Adapter {
  name: string;
  description: string;
  kind: "wifi" | "ethernet" | "cellular" | "other";
  up: boolean;
  linkBps: number;
  received: number;
  sent: number;
}

export interface BatteryState {
  present: boolean;
  percent: number | null;
  charging: boolean;
  pluggedIn: boolean;
  secondsLeft: number | null;
  saver: boolean;
  at: number;
}

export interface Sensor {
  id: string;
  label: string;
  isCpu: boolean;
  celsius: number;
  history: number[];
}

export interface ThermalSample {
  available: boolean;
  reason: string | null;
  source: string;
  sensors: Sensor[];
  intervalSecs: number;
  at: number;
}

export interface DisplayBrightness {
  id: string;
  name: string;
  kind: "internal" | "external";
  percent: number | null;
  primary: boolean;
}

export interface WifiToggle {
  on: boolean;
  connected: boolean;
  online: boolean;
  ssid: string | null;
  signal: number | null;
}

export interface ToggleState {
  online: boolean;
  wifi: WifiToggle | null;
  bluetooth: boolean | null;
  cellular: boolean | null;
  airplane: boolean | null;
  hotspot: { capable: boolean; on: boolean; clients: number } | null;
  ethernet: { connected: boolean; name: string | null } | null;
  energySaver: boolean | null;
  dnd: boolean | null;
  keepAwake: boolean;
  desktopIcons: boolean | null;
  displayMode: DisplayMode | null;
  /** True = live (not muted). */
  microphone: boolean | null;
  /** True = apps may use the camera. */
  camera: boolean | null;
  at: number;
}

export type DisplayMode = "internal" | "clone" | "extend" | "external";

export interface ToggleResult {
  openedSettings: boolean;
}

export interface BtDevice {
  id: string;
  name: string;
  connected: boolean;
  battery: number | null;
  kind: "audio" | "input" | "phone" | "computer" | "other";
}

export interface ThemeState {
  appsLight: boolean;
  systemLight: boolean;
}

export interface KeyboardLayout {
  id: string;
  short: string;
  region: string;
  language: string;
  layout: string;
}

export interface LanguageState {
  current: KeyboardLayout | null;
  layouts: KeyboardLayout[];
}

export interface TrayIcon {
  key: string;
  hwnd: number;
  uid: number;
  callback: number;
  tooltip: string;
  icon: string | null;
  overflow: boolean;
}

export interface TrayList {
  supported: boolean;
  reason: string | null;
  icons: TrayIcon[];
}
