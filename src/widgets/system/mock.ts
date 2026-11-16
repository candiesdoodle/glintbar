/** Browser-preview data for the system slice. Loaded only when there is no Tauri backend. */
import { mockEmit, mockService, mockTopic } from "../../core/mock";
import type { CpuInfo, CpuSample } from "./cpu/types";
import type {
  Adapter,
  AppUsage,
  BatteryState,
  BtDevice,
  DisplayBrightness,
  LanguageState,
  MemorySample,
  NetSample,
  ProcSample,
  ThemeState,
  ThermalSample,
  ToggleState,
  TrayList,
} from "./shared/types";

const now = () => Date.now();
const r1 = (v: number) => Math.round(v * 10) / 10;
const walk = (v: number, target: number, jitter: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * jitter + (target - v) * 0.15));

// ---- CPU (reference) ---------------------------------------------------------------------------

let usage = 18;
const history: number[] = [];

function nextCpu(): CpuSample {
  // A believable random walk around ~20 % with the odd spike.
  const spike = Math.random() < 0.06 ? 35 : 0;
  usage = Math.min(97, Math.max(3, usage + (Math.random() - 0.5) * 12 + (20 - usage) * 0.12 + spike));
  history.push(r1(usage));
  if (history.length > 60) history.shift();
  return { usage: r1(usage), history: [...history], at: now() };
}
for (let i = 0; i < 45; i++) nextCpu();

mockService("system", {
  cpu_info: (): CpuInfo => ({
    name: "AMD Ryzen 7 7840U w/ Radeon 780M Graphics",
    logicalCores: 16,
    baseMhz: 3301,
    uptimeSecs: 3 * 86400 + 4 * 3600 + 12 * 60,
    usage,
  }),
});

mockTopic("system", "cpu", { every: 1000, sample: nextCpu });

// ---- memory ------------------------------------------------------------------------------------

const TOTAL = 32 * 2 ** 30;
let memPct = 58;
const memHistory: number[] = [];
function nextMemory(): MemorySample {
  memPct = walk(memPct, 58, 1.6, 30, 92);
  memHistory.push(r1(memPct));
  if (memHistory.length > 60) memHistory.shift();
  const used = Math.round((TOTAL * memPct) / 100);
  return {
    usage: r1(memPct),
    used,
    total: TOTAL,
    available: TOTAL - used,
    commitUsed: Math.round(used * 1.18),
    commitLimit: Math.round(TOTAL * 1.4),
    history: [...memHistory],
    at: now(),
  };
}
for (let i = 0; i < 50; i++) nextMemory();
mockTopic("system", "memory", { every: 2000, sample: nextMemory });

// ---- per-app usage -----------------------------------------------------------------------------

const APPS: Array<{ name: string; exe: string; cpu: number; mb: number; n: number }> = [
  { name: "Google Chrome", exe: "chrome.exe", cpu: 6.5, mb: 2650, n: 23 },
  { name: "Visual Studio Code", exe: "Code.exe", cpu: 3.2, mb: 1480, n: 11 },
  { name: "Microsoft Teams", exe: "ms-teams.exe", cpu: 1.8, mb: 820, n: 6 },
  { name: "Spotify", exe: "Spotify.exe", cpu: 1.1, mb: 410, n: 7 },
  { name: "Desktop Window Manager", exe: "dwm.exe", cpu: 2.4, mb: 160, n: 1 },
  { name: "Windows Explorer", exe: "explorer.exe", cpu: 0.6, mb: 190, n: 1 },
  { name: "Antimalware Service Executable", exe: "MsMpEng.exe", cpu: 0.9, mb: 240, n: 1 },
  { name: "GlintBar", exe: "glintbar.exe", cpu: 0.4, mb: 95, n: 4 },
  { name: "Slack", exe: "slack.exe", cpu: 0.5, mb: 530, n: 5 },
];
const appState = APPS.map((a) => ({ ...a }));
function nextProcs(): ProcSample {
  for (const a of appState) {
    const base = APPS.find((b) => b.exe === a.exe)!;
    a.cpu = Math.max(0, walk(a.cpu, base.cpu, base.cpu * 0.9 + 0.4, 0, 60));
    a.mb = Math.max(20, walk(a.mb, base.mb, base.mb * 0.03, base.mb * 0.7, base.mb * 1.4));
  }
  const rows: AppUsage[] = appState.map((a) => ({ name: a.name, exe: a.exe, cpu: r1(a.cpu), memory: Math.round(a.mb * 2 ** 20), processes: a.n }));
  return {
    cpu: [...rows].sort((a, b) => b.cpu - a.cpu).slice(0, 8),
    ram: [...rows].sort((a, b) => b.memory - a.memory).slice(0, 8),
    processCount: 241,
    at: now(),
  };
}
mockTopic("system", "procs", { every: 2000, sample: nextProcs });

// ---- network -----------------------------------------------------------------------------------

let down = 220_000;
let up = 40_000;
const downHistory: number[] = [];
const upHistory: number[] = [];
function nextNet(): NetSample {
  const burst = Math.random() < 0.08 ? 3_500_000 + Math.random() * 6_000_000 : 0;
  down = Math.max(2_000, walk(down, 260_000, 260_000, 0, 40_000_000) + burst * 0.6);
  up = Math.max(1_000, walk(up, 45_000, 50_000, 0, 8_000_000) + burst * 0.05);
  downHistory.push(Math.round(down));
  upHistory.push(Math.round(up));
  if (downHistory.length > 60) downHistory.shift();
  if (upHistory.length > 60) upHistory.shift();
  return { down: Math.round(down), up: Math.round(up), downHistory: [...downHistory], upHistory: [...upHistory], kind: "wifi", at: now() };
}
for (let i = 0; i < 55; i++) nextNet();
mockTopic("system", "network", { every: 1000, sample: nextNet });

const adapters: Adapter[] = [
  { name: "Wi-Fi", description: "Intel(R) Wi-Fi 6E AX211 160MHz", kind: "wifi", up: true, linkBps: 1_201_000_000, received: 18.4 * 2 ** 30, sent: 2.1 * 2 ** 30 },
  { name: "Ethernet", description: "Realtek USB GbE Family Controller", kind: "ethernet", up: false, linkBps: 0, received: 0, sent: 0 },
  { name: "Bluetooth Network Connection", description: "Bluetooth Device (Personal Area Network)", kind: "other", up: false, linkBps: 0, received: 0, sent: 0 },
];

// ---- battery -----------------------------------------------------------------------------------

let battery = 76;
let plugged = false;
function nextBattery(): BatteryState {
  battery = Math.max(5, Math.min(100, battery + (plugged ? 0.4 : -0.08)));
  if (battery <= 20) plugged = true;
  if (battery >= 100) plugged = false;
  const pct = Math.round(battery);
  return {
    present: true,
    percent: pct,
    charging: plugged && pct < 100,
    pluggedIn: plugged,
    secondsLeft: plugged ? null : Math.round(pct * 170),
    saver: !plugged && pct <= 20,
    at: now(),
  };
}

// ---- temperature -------------------------------------------------------------------------------

const sensors = [
  { id: "\\_TZ.CPUZ", label: "CPU", isCpu: true, c: 52, base: 52, history: [] as number[] },
  { id: "\\_TZ.GFXZ", label: "Graphics", isCpu: false, c: 47, base: 47, history: [] as number[] },
  { id: "\\_TZ.BATZ", label: "Battery", isCpu: false, c: 33, base: 33, history: [] as number[] },
];
function nextThermal(): ThermalSample {
  for (const s of sensors) {
    const spike = s.isCpu && Math.random() < 0.05 ? 14 : 0;
    s.c = walk(s.c, s.base + usage * 0.18, 2.2, 25, 98) + spike * 0.5;
    s.history.push(r1(s.c));
    if (s.history.length > 200) s.history.shift();
  }
  return {
    available: true,
    reason: null,
    source: "perf",
    sensors: sensors.map((s) => ({ id: s.id, label: s.label, isCpu: s.isCpu, celsius: r1(s.c), history: [...s.history] })),
    intervalSecs: 3,
    at: now(),
  };
}
for (let i = 0; i < 150; i++) nextThermal();
mockTopic("system", "thermal", { every: 3000, sample: nextThermal });

// ---- brightness, toggles, Bluetooth, theme -----------------------------------------------------

const displays: DisplayBrightness[] = [
  { id: "wmi:DISPLAY\\BOE0A4E\\4&1a2b3c&0&UID8388688_0", name: "Built-in display", kind: "internal", percent: 70, primary: true },
  { id: "ddc:\\\\.\\DISPLAY2#0", name: "DELL U2723QE", kind: "external", percent: 45, primary: false },
];

const toggles: ToggleState = {
  online: true,
  wifi: { on: true, connected: true, online: true, ssid: "Home 5G", signal: 4 },
  bluetooth: true,
  cellular: null,
  airplane: false,
  hotspot: { capable: true, on: false, clients: 0 },
  ethernet: { connected: false, name: null },
  energySaver: false,
  dnd: false,
  keepAwake: false,
  desktopIcons: true,
  displayMode: "extend",
  microphone: true,
  camera: true,
  at: now(),
};

const btDevices: BtDevice[] = [
  { id: "bt:1", name: "WH-1000XM5", connected: true, battery: 80, kind: "audio" },
  { id: "bt:2", name: "MX Master 3S", connected: true, battery: 55, kind: "input" },
  { id: "bt:3", name: "Pixel 8", connected: false, battery: null, kind: "phone" },
  { id: "bt:4", name: "Keychron K3", connected: false, battery: null, kind: "input" },
];

const theme: ThemeState = { appsLight: false, systemLight: false };

let oskOpen = false;

// ---- keyboard layouts --------------------------------------------------------------------------

const layouts = [
  { id: "04090409", short: "ENG", region: "US", language: "English (United States)", layout: "US" },
  { id: "04070407", short: "DEU", region: "DE", language: "German (Germany)", layout: "German" },
  { id: "04190419", short: "RUS", region: "RU", language: "Russian (Russia)", layout: "Russian" },
];
let layoutIndex = 0;
const languageState = (): LanguageState => ({ current: layouts[layoutIndex], layouts });

// ---- tray --------------------------------------------------------------------------------------

function svgIcon(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const trayIcons: TrayList = {
  supported: true,
  reason: null,
  icons: [
    { key: "1:1", hwnd: 1, uid: 1, callback: 1025, tooltip: "OneDrive - Up to date", overflow: false, icon: svgIcon('<path d="M9 24h15a5 5 0 0 0 .6-10A7 7 0 0 0 11 12.5 5.8 5.8 0 0 0 9 24z" fill="#2f8cf5"/>') },
    { key: "2:1", hwnd: 2, uid: 1, callback: 1025, tooltip: "Discord", overflow: false, icon: svgIcon('<rect x="4" y="7" width="24" height="18" rx="8" fill="#5865f2"/><circle cx="12.5" cy="16" r="2.2" fill="#fff"/><circle cx="19.5" cy="16" r="2.2" fill="#fff"/>') },
    { key: "3:1", hwnd: 3, uid: 1, callback: 1025, tooltip: "Windows Security - no actions needed", overflow: true, icon: svgIcon('<path d="M16 4l10 4v7c0 7-4.5 11-10 13C10.5 26 6 22 6 15V8z" fill="#3b82f6"/><path d="M12 16l3 3 5-6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>') },
    { key: "4:1", hwnd: 4, uid: 1, callback: 1025, tooltip: "Steam", overflow: true, icon: svgIcon('<circle cx="16" cy="16" r="12" fill="#1b2838"/><circle cx="19.5" cy="13" r="4" fill="none" stroke="#c7d5e0" stroke-width="2"/><circle cx="12" cy="20" r="2.6" fill="#c7d5e0"/>') },
    { key: "5:1", hwnd: 5, uid: 1, callback: 1025, tooltip: "NVIDIA Settings", overflow: true, icon: svgIcon('<rect x="5" y="5" width="22" height="22" rx="5" fill="#76b900"/><path d="M10 17c3-5 9-5 12 0-3 5-9 5-12 0z" fill="#fff"/>') },
    { key: "6:1", hwnd: 6, uid: 1, callback: 1025, tooltip: "Slack", overflow: true, icon: svgIcon('<rect x="6" y="13" width="9" height="4" rx="2" fill="#e01e5a"/><rect x="17" y="15" width="9" height="4" rx="2" fill="#2eb67d"/><rect x="13" y="6" width="4" height="9" rx="2" fill="#36c5f0"/><rect x="15" y="17" width="4" height="9" rx="2" fill="#ecb22e"/>') },
    { key: "7:1", hwnd: 7, uid: 1, callback: 1025, tooltip: "Bluetooth Devices", overflow: true, icon: svgIcon('<circle cx="16" cy="16" r="12" fill="#2563eb"/><path d="M12 11l8 8-4 3V10l4 3-8 8" stroke="#fff" stroke-width="2" fill="none" stroke-linejoin="round"/>') },
    { key: "8:1", hwnd: 8, uid: 1, callback: 1025, tooltip: "Safely Remove Hardware and Eject Media", overflow: true, icon: svgIcon('<rect x="9" y="12" width="14" height="13" rx="2" fill="#94a3b8"/><rect x="12" y="6" width="8" height="7" rx="1" fill="#cbd5e1"/>') },
  ],
};

// ---- services ----------------------------------------------------------------------------------

mockService("system", {
  memory_info: () => nextMemory(),
  battery_info: () => nextBattery(),
  network_adapters: () => adapters,
  brightness_list: () => displays,
  brightness_set: ({ id, percent }: { id: string; percent: number }) => {
    const d = displays.find((x) => x.id === id);
    if (d) d.percent = Math.max(0, Math.min(100, Math.round(percent)));
  },
  toggles_state: () => ({ ...toggles, at: now() }),
  toggle_set: ({ id, on, mode }: { id: string; on?: boolean; mode?: string }) => {
    const t = toggles;
    switch (id) {
      case "wifi":
        if (t.wifi) t.wifi = on ? { on: true, connected: true, online: true, ssid: "Home 5G", signal: 4 } : { on: false, connected: false, online: false, ssid: null, signal: null };
        t.online = !!on;
        break;
      case "bluetooth":
        t.bluetooth = !!on;
        break;
      case "hotspot":
        if (t.hotspot) t.hotspot = { ...t.hotspot, on: !!on, clients: on ? 1 : 0 };
        break;
      case "dnd":
        t.dnd = !!on;
        break;
      case "keepAwake":
        t.keepAwake = !!on;
        break;
      case "desktopIcons":
        t.desktopIcons = !t.desktopIcons;
        break;
      case "microphone":
        t.microphone = !!on;
        break;
      case "camera":
        t.camera = !!on;
        break;
      case "displayMode":
        if (mode) t.displayMode = mode as ToggleState["displayMode"];
        else return { openedSettings: true };
        break;
      case "airplane":
      case "ethernet":
      case "energySaver":
        console.info("[mock] open settings for", id);
        return { openedSettings: true };
    }
    return { openedSettings: false };
  },
  dnd_state: () => toggles.dnd,
  bluetooth_devices: () => btDevices,
  theme_get: () => ({ ...theme }),
  theme_set: ({ light, apps = true, system = true }: { light: boolean; apps?: boolean; system?: boolean }) => {
    if (apps) theme.appsLight = light;
    if (system) theme.systemLight = light;
    return { ...theme };
  },
  language_state: () => languageState(),
  language_set: ({ id }: { id: string }) => {
    const i = layouts.findIndex((l) => l.id === id);
    if (i >= 0) layoutIndex = i;
    mockEmit("system", "language", languageState());
    return languageState();
  },
  language_next: () => {
    layoutIndex = (layoutIndex + 1) % layouts.length;
    mockEmit("system", "language", languageState());
    return languageState();
  },
  tray_list: () => trayIcons,
  tray_click: (a: { hwnd: number; button: string }) => console.info("[mock] tray click", a.hwnd, a.button),
  tray_overflow: () => console.info("[mock] open the tray overflow"),
  notifications_toggle: () => console.info("[mock] Win+N"),
  quick_settings_open: () => console.info("[mock] Win+A"),
  show_desktop: () => console.info("[mock] Win+D"),
  keyboard_state: () => oskOpen,
  keyboard_toggle: () => (oskOpen = !oskOpen),
});

mockTopic("system", "battery", { every: 5000, sample: nextBattery });
mockTopic("system", "language", { every: 1000, sample: languageState });
