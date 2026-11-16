/**
 * The mock backend used when the UI runs in a plain browser (no Tauri). Slices register sample
 * data in `src/widgets/<domain>/mock.ts`:
 *
 *   mockService("system", { cpu_info: () => ({ name: "…", logicalCores: 8 }) });
 *   mockTopic("system", "cpu", { every: 1000, sample: () => ({ usage: 12 }) });
 *
 * Those files are loaded lazily (never in the Tauri build at runtime) by `loadMocks()`.
 * Core services (store, secrets, http, fs, shell, app) are mocked here.
 */

export type MockHandler = (args: any) => unknown | Promise<unknown>;

export interface MockTopicSpec<T> {
  /** Poll: call `sample` every `every` ms while subscribed (first sample immediately). */
  every?: number;
  sample?: () => T;
  /** Or push: start emitting, return a stop function. */
  start?: (emit: (payload: T) => void) => (() => void) | void;
}

const services = new Map<string, Record<string, MockHandler>>();
const topicSpecs = new Map<string, MockTopicSpec<unknown>>();
const pushListeners = new Map<string, Set<(p: unknown) => void>>();

/** Adds (or overrides) mock methods for a service. */
export function mockService(service: string, handlers: Record<string, MockHandler>): void {
  services.set(service, { ...(services.get(service) ?? {}), ...handlers });
}

export function mockTopic<T>(service: string, topic: string, spec: MockTopicSpec<T>): void {
  topicSpecs.set(`${service}/${topic}`, spec as MockTopicSpec<unknown>);
}

/** Emits an event to whoever listens (like Rust's `events::emit`). */
export function mockEmit(service: string, topic: string, payload: unknown): void {
  for (const l of pushListeners.get(`${service}/${topic}`) ?? []) l(payload);
}

export class MockError extends Error {}

let latencyMs = 40;
export function setMockLatency(ms: number) {
  latencyMs = ms;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockCall<T>(service: string, method: string, args?: unknown): Promise<T> {
  if (latencyMs > 0) await sleep(latencyMs);
  const handler = services.get(service)?.[method];
  if (!handler) throw `unknown_method: ${service}.${method} (no mock registered)`;
  const result = await handler(args ?? {});
  return (result === undefined ? null : structuredClone(result)) as T;
}

export function mockSubscribe(service: string, topic: string, emit: (payload: unknown) => void): () => void {
  const key = `${service}/${topic}`;
  let set = pushListeners.get(key);
  if (!set) pushListeners.set(key, (set = new Set()));
  set.add(emit);
  const stops: Array<() => void> = [() => set!.delete(emit)];
  const spec = topicSpecs.get(key);
  if (spec?.start) {
    const stop = spec.start(emit);
    if (stop) stops.push(stop);
  } else if (spec?.sample) {
    const sample = spec.sample;
    emit(sample());
    const t = setInterval(() => emit(sample()), spec.every ?? 1000);
    stops.push(() => clearInterval(t));
  }
  return () => stops.forEach((s) => s());
}

/** Loads every slice's mock.ts. Called once at startup in browser mode only. */
export async function loadMocks(): Promise<void> {
  const modules = import.meta.glob("../widgets/*/mock.ts");
  await Promise.all(Object.values(modules).map((load) => load()));
  // ?profile=bare: what a PC with no battery, audio, radios or media session returns.
  if (new URLSearchParams(location.search).get("profile") === "bare") await import("./mockBare");
}

// ---- core service mocks -------------------------------------------------------------------------

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

const STORE_KEY = "glintbar.store";
const SECRETS_KEY = "glintbar.secrets";

mockService("store", {
  all: () => lsGet<Record<string, unknown>>(STORE_KEY, {}),
  get: ({ key }: { key: string }) => lsGet<Record<string, unknown>>(STORE_KEY, {})[key] ?? null,
  set: ({ key, value }: { key: string; value: unknown }) => {
    const all = lsGet<Record<string, unknown>>(STORE_KEY, {});
    all[key] = value;
    lsSet(STORE_KEY, all);
    mockEmit("store", "changed", { key, value });
  },
  delete: ({ key }: { key: string }) => {
    const all = lsGet<Record<string, unknown>>(STORE_KEY, {});
    delete all[key];
    lsSet(STORE_KEY, all);
    mockEmit("store", "changed", { key, value: null });
  },
});

mockService("secrets", {
  get: ({ key }: { key: string }) => lsGet<Record<string, string>>(SECRETS_KEY, {})[key] ?? null,
  has: ({ key }: { key: string }) => key in lsGet<Record<string, string>>(SECRETS_KEY, {}),
  set: ({ key, value }: { key: string; value: string }) => {
    const all = lsGet<Record<string, string>>(SECRETS_KEY, {});
    if (value) all[key] = value;
    else delete all[key];
    lsSet(SECRETS_KEY, all);
  },
  delete: ({ key }: { key: string }) => {
    const all = lsGet<Record<string, string>>(SECRETS_KEY, {});
    delete all[key];
    lsSet(SECRETS_KEY, all);
  },
});

mockService("http", {
  // Real fetch where CORS allows it; widgets should show sample data in the browser anyway.
  fetch: async (a: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
    if (/\{\{secret:/.test(a.url + JSON.stringify(a.headers ?? {}) + (a.body ?? ""))) {
      throw "missing_secret: the browser preview never sends secrets";
    }
    try {
      const res = await fetch(a.url, { method: a.method ?? "GET", headers: a.headers, body: a.body });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { status: res.status, ok: res.ok, url: res.url, headers, body: await res.text() };
    } catch (e) {
      throw `offline: ${String(e)}`;
    }
  },
});

mockService("fs", {
  exists: () => false,
  stat: () => ({ exists: false, isDir: false, isFile: false, size: 0, modified: null }),
  read_text: ({ path }: { path: string }) => {
    throw `not_found: ${path} (no file system in the browser preview)`;
  },
  list_dir: () => [],
  expand: ({ path }: { path: string }) => path.replace(/%USERPROFILE%/gi, "C:\\Users\\you"),
  known_dirs: () => ({
    home: "C:\\Users\\you",
    appData: "C:\\Users\\you\\AppData\\Roaming",
    localAppData: "C:\\Users\\you\\AppData\\Local",
    temp: "C:\\Users\\you\\AppData\\Local\\Temp",
    glintbarData: "C:\\Users\\you\\AppData\\Roaming\\GlintBar",
  }),
});

mockService("shell", {
  open: ({ target }: { target: string }) => {
    if (/^https?:/i.test(target)) window.open(target, "_blank", "noopener");
    else console.info("[mock] shell.open", target);
  },
  run: ({ command }: { command: string }) => {
    console.info("[mock] shell.run", command);
    return { pid: null, code: 0, stdout: "", stderr: "" };
  },
  set_dock: () => undefined,
  set_overlay: () => undefined,
  set_focusable: () => undefined,
  show: () => undefined,
  get_state: () => ({ geometry: null, overlay: 0, scale: window.devicePixelRatio, appBar: false, taskbarHidden: false }),
});

mockService("app", {
  info: () => ({
    name: "GlintBar",
    version: "0.1.2",
    identifier: "dev.glintbar.dock",
    dataDir: "C:\\Users\\you\\AppData\\Roaming\\GlintBar",
    logFile: "C:\\Users\\you\\AppData\\Roaming\\GlintBar\\logs\\glintbar.log",
    debug: true,
    os: "browser",
  }),
  quit: () => console.info("[mock] quit"),
  relaunch: () => location.reload(),
  autostart_get: () => lsGet("glintbar.autostart", true),
  autostart_set: ({ enabled }: { enabled: boolean }) => {
    lsSet("glintbar.autostart", enabled);
    return enabled;
  },
  open_logs: () => console.info("[mock] open logs"),
  open_data_dir: () => console.info("[mock] open data dir"),
  log: ({ level, message }: { level: string; message: string }) => console.info(`[ui:${level}]`, message),
});
