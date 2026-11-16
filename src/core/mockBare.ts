/**
 * "Bare machine" mock profile (`?profile=bare` in the browser preview): the payloads a real
 * Windows PC with no battery, audio device, Wi-Fi/Bluetooth radio, media session, brightness
 * control, temperature sensor or AI CLIs returns. Taken verbatim from a smoke run on a Windows
 * Server runner (selftest.json); long lists are shortened. Use it to check empty states:
 *   http://localhost:4173/?profile=bare&reset=1
 */
import { mockService, mockTopic } from "./mock";

const T = 1794835735263;

const battery = { at: T, charging: false, percent: null, pluggedIn: true, present: false, saver: false, secondsLeft: null };
const nowPlaying = {
  accent: null, active: false, album: "", appIcon: null, appId: "", appName: "", artist: "", canNext: false,
  canPlayPause: false, canPrevious: false, canSeek: false, cover: null, durationMs: null, others: [],
  positionMs: null, rate: 1, status: "closed", title: "", updatedAt: 0,
};
const audio = { input: null, output: null };
const thermal = { at: T, available: false, intervalSecs: 3, reason: "Windows reports no temperature sensor on this PC.", sensors: [], source: "" };
const toggles = {
  airplane: false, at: T, bluetooth: null, camera: false, cellular: null, desktopIcons: true, displayMode: "internal",
  dnd: true, energySaver: null, ethernet: { connected: true, name: "Ethernet 4" }, hotspot: null, keepAwake: false,
  microphone: null, online: true, wifi: null,
};
const notInstalled = (tool: string, message: string) => ({
  asOf: null, billing: null, details: [], fetchedAt: T, limits: [], message, plan: null, source: "none", status: "not_installed", tool,
});

mockService("system", {
  battery_info: () => ({ ...battery, at: Date.now() }),
  bluetooth_devices: () => [],
  brightness_list: () => [{ id: "ddc:\\\\.\\DISPLAY1#0", kind: "external", name: "Display 1", percent: null, primary: true }],
  brightness_set: () => {
    throw "unsupported: brightness can't be set on this display";
  },
  cpu_info: () => ({ baseMhz: 2596, logicalCores: 2, name: "AMD EPYC 9V74 80-Core Processor", uptimeSecs: 665, usage: 31.25 }),
  dnd_state: () => true,
  keyboard_state: () => false,
  toggles_state: () => ({ ...toggles, at: Date.now() }),
  tray_list: () => ({ icons: [], reason: "Tray icons can't be listed on this Windows version because it draws them itself.", supported: false }),
  theme_get: () => ({ appsLight: true, systemLight: true }),
  language_state: () => ({
    current: { id: "04090409", language: "English (United States)", layout: "US", region: "US", short: "ENG" },
    layouts: [{ id: "04090409", language: "English (United States)", layout: "US", region: "US", short: "ENG" }],
  }),
});
mockTopic("system", "battery", { every: 5000, sample: () => ({ ...battery, at: Date.now() }) });
mockTopic("system", "thermal", { every: 3000, sample: () => ({ ...thermal, at: Date.now() }) });

mockService("media", {
  apps: () => [],
  audio_get: () => audio,
  outputs: () => [],
  now_playing_get: () => nowPlaying,
});
mockTopic("media", "audio", { start: (emit) => void emit(audio) });
mockTopic("media", "now_playing", { start: (emit) => void emit(nowPlaying) });

mockService("productivity", {
  whatsapp_status: () => ({
    access: "denied", chats: [], lastAt: null, lastSender: null,
    message: "GlintBar isn't allowed to read notifications. Allow it in Settings > Privacy & security > Notifications.", unread: 0,
  }),
  screentime_status: () => ({ daysKept: 0, paused: false, sitesOn: false, tracking: true }),
  screentime_day: ({ date }: { date?: string } = {}) => ({
    apps: [], date: date ?? new Date().toISOString().slice(0, 10), firstActive: null, hours: new Array(24).fill(0), lastActive: null,
    longestFocusApp: null, longestFocusSecs: 0, segments: null, sites: [], sitesOn: false, switches: 0, totalSecs: 0, tracking: true,
  }),
  screentime_days: ({ days = 7 }: { days?: number } = {}) =>
    Array.from({ length: days }, (_, i) => ({ apps: [], date: new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10), totalSecs: 0 })),
});

mockService("ai", {
  claude_local: () => ({ found: false, lastActivity: null, models: [], pending: false, scannedAt: T, series: [], week: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 } }),
  claude_usage: () => notInstalled("claude", "Claude Code wasn't found on this PC. Install it, log in through claude, then use Check again."),
  codex_usage: () => notInstalled("chatgpt", "The Codex CLI wasn't found on this PC. Add it with npm install -g @openai/codex, then type codex login and use your ChatGPT account."),
  cursor_usage: () => notInstalled("cursor", "Cursor wasn't found on this PC, or it hasn't been started yet. Start Cursor, log in, then click Check again."),
  gemini_usage: () => notInstalled("gemini", "The Gemini CLI wasn't found on this PC. Install it, start gemini and pick Login with Google."),
  grok_usage: () => ({
    ...notInstalled("grok", "SuperGrok credits can't be read yet because xAI offers other apps no way to see them. Until that changes, the tile shows sample figures."),
    status: "unavailable",
  }),
  opencode_usage: () => ({
    fetchedAt: T, lastActivity: null, message: "OpenCode hasn't left any history on this PC yet. Start opencode once, then click Check again.", models: [], series: [], session: null,
    status: "not_installed", week: { cost: 0, messages: 0, tokens: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, reasoning: 0 } },
  }),
});

// A fresh install has no free-space history yet (the apps mock seeds one for the preview).
try {
  const store = JSON.parse(localStorage.getItem("glintbar.store") ?? "{}") as Record<string, unknown>;
  delete store["apps.storageHistory"];
  localStorage.setItem("glintbar.store", JSON.stringify(store));
} catch {
  /* storage blocked */
}

mockService("apps", {
  drives: () => [
    { free: 30489092096, fs: "NTFS", kind: "fixed", label: "Windows", letter: "C", root: "C:\\", system: true, total: 160939618304 },
    { free: 115478859776, fs: "NTFS", kind: "fixed", label: "Temp", letter: "D", root: "D:\\", system: false, total: 118093770752 },
  ],
  recycle_info: () => ({ bytes: 0, count: 0 }),
  recent: () => ({ apps: [], files: [] }),
});
mockTopic("apps", "recycle", { start: (emit) => void emit({ bytes: 0, count: 0 }) });
