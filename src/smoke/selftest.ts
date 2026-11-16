/**
 * Service self-test (smoke mode): calls every READ-ONLY Rust method with safe arguments and
 * listens to every live topic for a few seconds, against the real backend. Results go to
 * smoke/selftest.json.
 *
 * Every method is either in SAFE (called) or in DENY (with the reason it would change the
 * machine). A method in neither list is denied too ("not reviewed"): add it to one of them after
 * reading its Rust handler. Shape checks compare each result with what the browser mock for the
 * same method returns (the mocks are the UI's picture of the data).
 */
import { BackendError, call, on, toBackendError } from "../core/backend";
import { loadMocks, mockCall, mockSubscribe, setMockLatency } from "../core/mock";
import manifest from "./rust-ipc.json";
import { preview, sleep, withTimeout, writeSmokeJson } from "./io";

type Ctx = { home: string; appData: string; glintbarData: string; temp: string; hwnd: number | null };
type ArgsSpec = unknown | ((ctx: Ctx) => unknown);

const SMOKE_KEY = "smoke.selftest";

/** Read-only methods and the arguments they get. */
export const SAFE: Record<string, ArgsSpec> = {
  "ai.claude_local": {},
  "ai.claude_usage": {}, // reads Claude Code's sign-in file; only calls the vendor when one exists (none on CI)
  "ai.codex_usage": {},
  "ai.cursor_usage": {},
  "ai.gemini_usage": {},
  "ai.grok_usage": {},
  "ai.opencode_usage": {},
  "app.autostart_get": {},
  "app.info": {},
  "app.log": { level: "info", message: "smoke self-test" },
  "appearance.glass_state": {},
  "appearance.system_theme": {},
  "appearance.wallpaper_info": {},
  "apps.drives": {},
  "apps.folder_sizes": (c: Ctx) => ({ root: c.home }),
  "apps.icon": { source: "C:\\Windows\\explorer.exe", size: 32 },
  "apps.installed": { refresh: false },
  "apps.jump_list": { exe: "C:\\Windows\\explorer.exe", limit: 5 },
  "apps.list_folder": (c: Ctx) => ({ path: c.home, limit: 20 }),
  "apps.preview": (c: Ctx) => (c.hwnd ? { hwnd: c.hwnd, width: 160 } : SKIP),
  "apps.recent": { limit: 5 },
  "apps.recycle_info": {},
  "apps.resolve": { paths: ["C:\\Windows\\notepad.exe", "C:\\Windows\\explorer.exe"] },
  "apps.taskbar_pins": {},
  "apps.windows": {},
  "core.active_topics": {},
  "fs.exists": (c: Ctx) => ({ path: c.glintbarData }),
  "fs.expand": { path: "%USERPROFILE%\\x" },
  "fs.known_dirs": {},
  "fs.list_dir": (c: Ctx) => ({ path: c.glintbarData, limit: 50 }),
  "fs.read_text": (c: Ctx) => ({ path: c.glintbarData + "\\store.json", maxBytes: 200 }),
  "fs.stat": (c: Ctx) => ({ path: c.glintbarData }),
  "media.apps": {},
  "media.audio_get": {},
  "media.now_playing_get": {},
  "media.outputs": {},
  "productivity.screentime_day": {},
  "productivity.screentime_days": { days: 7 },
  "productivity.screentime_status": {},
  "productivity.whatsapp_status": {},
  "secrets.get": { key: SMOKE_KEY },
  "secrets.has": { key: SMOKE_KEY },
  "shell.get_state": {},
  "shell.monitors": {},
  "shell.window_info": { label: "main" },
  "smoke.blocked": {},
  "smoke.methods": {},
  "smoke.status": {},
  "smoke.topics": {},
  "smoke.window": { label: "main" },
  "store.all": {},
  "store.get": { key: "settings" },
  // store writes only under the "smoke." prefix, in this order (set, read back, delete)
  "store.set": { key: SMOKE_KEY, value: { written: "by the smoke self-test" } },
  "store.delete": { key: SMOKE_KEY },
  "system.battery_info": {},
  "system.bluetooth_devices": {},
  "system.brightness_list": {},
  "system.cpu_info": {},
  "system.dnd_state": {},
  "system.keyboard_state": {},
  "system.language_state": {},
  "system.memory_info": {},
  "system.network_adapters": {},
  "system.theme_get": {},
  "system.toggles_state": {},
  "system.tray_list": {},
};

/** Methods that change the machine (or the running dock), with the reason they are not called. */
export const DENY: Record<string, string> = {
  "app.autostart_set": "changes launch at sign-in",
  "app.open_data_dir": "opens an Explorer window",
  "app.open_logs": "opens an Explorer window",
  "app.quit": "quits the app (the driver quits at the end)",
  "app.relaunch": "restarts the app",
  "appearance.export_settings": "writes a file outside the smoke folder",
  "appearance.glass_ack": "drives the live glass renderer (the UI does this itself)",
  "appearance.glass_attach": "drives the live glass renderer (the UI does this itself)",
  "appearance.glass_config": "changes the live glass renderer settings",
  "apps.capture": "takes a screenshot to a file / the clipboard",
  "apps.capture_region": "opens the snipping overlay",
  "apps.close": "closes a window",
  "apps.end_task": "ends a process",
  "apps.focus": "activates another window",
  "apps.launch": "launches a program",
  "apps.minimize": "minimizes a window",
  "apps.quick_menu": "opens the Win+X menu",
  "apps.recycle_empty": "empties the Recycle Bin",
  "apps.recycle_files": "moves files to the Recycle Bin",
  "apps.reveal": "opens an Explorer window",
  "apps.start_menu": "opens the Start menu",
  "apps.toggle": "shows/minimizes a window",
  "core.reset_subscriptions": "drops the dock's own live subscriptions",
  "core.subscribe": "exercised by the topic test",
  "core.unsubscribe": "exercised by the topic test",
  "http.fetch": "network: the self-test never touches the network",
  "media.control": "play/pause/skip on the media session",
  "media.set_app_volume": "changes an app's volume",
  "media.set_muted": "mutes/unmutes",
  "media.set_output": "switches the audio output device",
  "media.set_volume": "changes the volume",
  "online.oauth_refresh": "OAuth: network and token writes",
  "online.oauth_sign_in": "starts an OAuth sign-in in the browser",
  "online.set_wallpaper": "sets the wallpaper",
  "productivity.screentime_forget_sites": "deletes recorded screen-time data",
  "productivity.whatsapp_request_access": "asks Windows for notification access (prompt)",
  "secrets.delete": "Credential Manager write",
  "secrets.set": "Credential Manager write",
  "shell.begin_drag": "moves the dock with the mouse",
  "shell.close_ready": "tells Rust a closing dock window may go",
  "shell.hotkeys_set": "registers global hotkeys (the dock does this itself)",
  "shell.open": "launches a program / URL",
  "shell.reveal": "changes auto-hide state",
  "shell.run": "runs a command line",
  "shell.set_dock": "moves/reserves the dock (the UI does this itself)",
  "shell.set_focusable": "changes window focus behaviour",
  "shell.set_hit_rects": "changes the click-through region (the UI does this itself)",
  "shell.set_hover": "changes auto-hide state",
  "shell.set_overlay": "resizes the dock window",
  "shell.show": "shows the dock window",
  "smoke.allow_launch": "lets launches through the smoke guard (driver only)",
  "smoke.capture_override": "lets live glass hide the dock from captures (driver only)",
  "smoke.read": "harness file access",
  "smoke.write": "harness file access",
  "system.brightness_set": "changes display brightness",
  "system.keyboard_toggle": "opens the touch keyboard",
  "system.language_next": "switches the input language",
  "system.language_set": "switches the input language",
  "system.notifications_toggle": "opens the notification centre",
  "system.quick_settings_open": "opens Quick Settings",
  "system.show_desktop": "minimizes every window",
  "system.theme_set": "switches the Windows light/dark theme",
  "system.toggle_set": "switches Wi-Fi/Bluetooth/airplane/etc.",
  "system.tray_click": "clicks another app's tray icon",
  "system.tray_overflow": "opens the tray overflow",
};

const SKIP = Symbol("skip");

/** Order matters for these (the rest run in parallel afterwards). */
const FIRST = ["fs.known_dirs", "apps.windows", "store.set", "store.get", "store.delete"];

export interface CallResult {
  name: string;
  status: "ok" | "error" | "timeout" | "denied" | "skipped";
  ms?: number;
  args?: unknown;
  code?: string;
  message?: string;
  preview?: string;
  shape?: { checked: boolean; problems: string[]; mock?: string };
  reason?: string;
}

export interface TopicResult {
  name: string;
  kind: string;
  events: number;
  firstAfterMs: number | null;
  sample?: string;
  shape?: { checked: boolean; problems: string[]; mock?: string };
  error?: string;
}

// ---- shape check ------------------------------------------------------------------------------

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Fields the mock has that the real result lacks or types differently (nulls are reported softly). */
export function shapeProblems(expected: unknown, actual: unknown, path = "", out: string[] = [], depth = 0): string[] {
  if (out.length >= 15 || depth > 5) return out;
  if (expected === undefined || expected === null) return out;
  const te = kindOf(expected);
  const ta = kindOf(actual);
  const here = path || "result";
  if (actual === undefined) {
    out.push(here + ": missing (mock has " + te + ")");
    return out;
  }
  if (ta === "null") {
    out.push(here + ": null (mock has " + te + ")");
    return out;
  }
  if (te !== ta) {
    out.push(here + ": " + ta + " (mock has " + te + ")");
    return out;
  }
  if (te === "array") {
    const e = expected as unknown[];
    const a = actual as unknown[];
    if (e.length && a.length) shapeProblems(e[0], a[0], path + "[0]", out, depth + 1);
    return out;
  }
  if (te === "object") {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    for (const k of Object.keys(e)) shapeProblems(e[k], a[k], path ? path + "." + k : k, out, depth + 1);
  }
  return out;
}

let mocksReady: Promise<void> | null = null;

function ensureMocks(): Promise<void> {
  if (!mocksReady) {
    setMockLatency(0);
    mocksReady = loadMocks().catch(() => {});
  }
  return mocksReady;
}

async function mockShape(service: string, method: string, args: unknown, actual: unknown) {
  try {
    const expected = await withTimeout(mockCall<unknown>(service, method, args), 2000, "mock");
    return { checked: true, problems: shapeProblems(expected, actual), mock: preview(expected, 160) };
  } catch {
    return { checked: false, problems: [] as string[] };
  }
}

function mockTopicSample(service: string, topic: string): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    let stop: () => void = () => {};
    const finish = (v: unknown) => {
      if (done) return;
      done = true;
      setTimeout(() => stop(), 0);
      resolve(v);
    };
    try {
      stop = mockSubscribe(service, topic, finish);
    } catch {
      finish(undefined);
    }
    setTimeout(() => finish(undefined), 1500);
  });
}

// ---- runner -----------------------------------------------------------------------------------

async function callOne(name: string, ctx: Ctx, timeoutMs: number): Promise<CallResult> {
  const dot = name.indexOf(".");
  const service = name.slice(0, dot);
  const method = name.slice(dot + 1);
  if (DENY[name]) return { name, status: "denied", reason: DENY[name] };
  if (!(name in SAFE)) return { name, status: "denied", reason: "not reviewed: denied by default (add it to SAFE or DENY in src/smoke/selftest.ts)" };
  const spec = SAFE[name];
  const args = typeof spec === "function" ? (spec as (c: Ctx) => unknown)(ctx) : spec;
  if (args === SKIP) return { name, status: "skipped", reason: "no input available for it" };
  const t0 = performance.now();
  try {
    const result = await withTimeout(call<unknown>(service, method, args), timeoutMs, name);
    const ms = Math.round(performance.now() - t0);
    return { name, status: "ok", ms, args, preview: preview(result), shape: await mockShape(service, method, args, result), _result: result } as CallResult;
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const err: BackendError | { code: string; message: string } =
      (e as { code?: string }).code === "timeout" && !(e instanceof BackendError) ? { code: "timeout", message: (e as Error).message } : toBackendError(e);
    return { name, status: err.code === "timeout" ? "timeout" : "error", ms, args, code: err.code, message: err.message.slice(0, 500) };
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function topicTest(service: string, topic: string, kind: string, listenMs: number): Promise<TopicResult> {
  const name = service + "/" + topic;
  let events = 0;
  let first: unknown;
  let firstAfterMs: number | null = null;
  const t0 = performance.now();
  let off: () => void = () => {};
  try {
    off = on<unknown>(service, topic, (p) => {
      events++;
      if (events === 1) {
        first = p;
        firstAfterMs = Math.round(performance.now() - t0);
      }
    });
  } catch (e) {
    return { name, kind, events: 0, firstAfterMs: null, error: String(e) };
  }
  await sleep(listenMs);
  off();
  const res: TopicResult = { name, kind, events, firstAfterMs };
  if (events > 0) {
    res.sample = preview(first, 300);
    const expected = await mockTopicSample(service, topic);
    res.shape = expected === undefined ? { checked: false, problems: [] } : { checked: true, problems: shapeProblems(expected, first), mock: preview(expected, 160) };
  }
  return res;
}

export interface SelftestOptions {
  timeoutMs?: number;
  listenMs?: number;
  concurrency?: number;
}

export async function runSelftest(opts: SelftestOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const listenMs = opts.listenMs ?? 3000;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  await ensureMocks();

  // What Rust really registered (live registry), and what the sources say (build-time manifest).
  const manifestMethods = manifest.methods.map((m) => m.service + "." + m.method);
  let runtime: string[] = [];
  let runtimeError: string | null = null;
  try {
    runtime = await call<string[]>("smoke", "methods");
  } catch (e) {
    runtimeError = String(toBackendError(e).message);
  }
  const methods = runtime.length ? runtime : manifestMethods;
  const runtimeSet = new Set(runtime);
  const manifestSet = new Set(manifestMethods);

  const ctx: Ctx = { home: "C:\\Users", appData: "", glintbarData: "", temp: "", hwnd: null };
  const results = new Map<string, CallResult>();
  const record = (r: CallResult) => results.set(r.name, r);

  for (const name of FIRST) {
    if (!methods.includes(name)) continue;
    const r = await callOne(name, ctx, timeoutMs);
    record(r);
    const value = (r as unknown as { _result?: unknown })._result;
    if (name === "fs.known_dirs" && value && typeof value === "object") {
      const d = value as { home?: string; appData?: string; glintbarData?: string; temp?: string };
      ctx.home = d.home ?? ctx.home;
      ctx.appData = d.appData ?? "";
      ctx.glintbarData = d.glintbarData ?? "";
      ctx.temp = d.temp ?? "";
    }
    if (name === "apps.windows" && Array.isArray(value)) {
      const w = value.find((x) => x && typeof x === "object" && typeof (x as { hwnd?: unknown }).hwnd === "number") as { hwnd: number } | undefined;
      ctx.hwnd = w ? w.hwnd : null;
    }
  }
  const rest = methods.filter((m) => !results.has(m));
  for (const r of await pool(rest, opts.concurrency ?? 4, (m) => callOne(m, ctx, timeoutMs))) record(r);

  // Topics with start/stop hooks (pollers and on_topic): live registry first, manifest as fallback.
  const manifestTopics = manifest.topics.filter((t) => t.kind !== "emit");
  let runtimeTopics: string[] = [];
  try {
    runtimeTopics = await call<string[]>("smoke", "topics");
  } catch {
    /* older build */
  }
  const topicKeys = runtimeTopics.length ? runtimeTopics : manifestTopics.map((t) => t.service + "/" + t.topic);
  const topicResults = await Promise.all(
    topicKeys.map((key) => {
      const slash = key.indexOf("/");
      const kind = manifestTopics.find((t) => t.service + "/" + t.topic === key)?.kind ?? "?";
      return topicTest(key.slice(0, slash), key.slice(slash + 1), kind, listenMs);
    }),
  );

  const calls = [...results.values()]
    .map((r) => {
      const { _result: _drop, ...clean } = r as CallResult & { _result?: unknown };
      return clean;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const count = (s: CallResult["status"]) => calls.filter((c) => c.status === s).length;
  const report = {
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    runtimeMethods: runtime.length,
    runtimeError,
    manifestMethods: manifestMethods.length,
    /** In the Rust sources but not registered at run time (cfg'd out, or a registration that never ran). */
    notAtRuntime: runtime.length ? manifestMethods.filter((m) => !runtimeSet.has(m)) : [],
    /** Registered at run time but not found by scripts/check-ipc.mjs (regenerate the manifest). */
    notInManifest: runtime.filter((m) => !manifestSet.has(m)),
    runtimeTopics: runtimeTopics.length,
    topicsNotAtRuntime: runtimeTopics.length ? manifestTopics.map((t) => t.service + "/" + t.topic).filter((k) => !runtimeTopics.includes(k)) : [],
    counts: { ok: count("ok"), error: count("error"), timeout: count("timeout"), denied: count("denied"), skipped: count("skipped") },
    shapeMismatches: calls.filter((c) => c.shape?.checked && c.shape.problems.length).length,
    topicsSilent: topicResults.filter((t) => t.events === 0).map((t) => t.name),
    calls,
    topics: topicResults,
  };
  await writeSmokeJson("selftest.json", report).catch(() => {});
  return {
    durationMs: report.durationMs,
    counts: report.counts,
    failed: calls.filter((c) => c.status === "error" || c.status === "timeout").map((c) => c.name + " " + (c.code ?? "") + ": " + (c.message ?? "")),
    topicsSilent: report.topicsSilent,
    notAtRuntime: report.notAtRuntime,
  };
}
