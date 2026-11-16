/**
 * The bridge to Rust. Everything goes through one Tauri command, `svc_call(service, method, args)`,
 * and events named `svc://<service>/<topic>`.
 *
 * - `call("system", "cpu_info")`            one request
 * - `on("system", "cpu", cb)`               live topic (ref-counted; Rust only polls while subscribed)
 * - `useService(...)` / `useTopic(...)`     React hooks; both pause while the tile is off-screen
 *
 * In a plain browser (no `window.__TAURI_INTERNALS__`) the same API routes to the mock backend
 * (`src/core/mock.ts` + every `src/widgets/<domain>/mock.ts`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { mockCall, mockSubscribe } from "./mock";
import { useIsVisible } from "./useVisible";
import { isMainWindow } from "./windowLabel";

export const isTauri: boolean = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type ErrorCode =
  | "bad_args"
  | "unknown_method"
  | "not_found"
  | "denied"
  | "missing_secret"
  | "offline"
  | "timeout"
  | "http"
  | "io"
  | "unsupported"
  | "internal"
  | "unknown";

const CODES: ReadonlySet<string> = new Set([
  "bad_args",
  "unknown_method",
  "not_found",
  "denied",
  "missing_secret",
  "offline",
  "timeout",
  "http",
  "io",
  "unsupported",
  "internal",
]);

export class BackendError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

/** Rust errors arrive as "code: message". */
export function toBackendError(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
  const m = /^([a-z_]+): ([\s\S]*)$/.exec(text);
  if (m && CODES.has(m[1])) return new BackendError(m[1] as ErrorCode, m[2]);
  return new BackendError("unknown", text);
}

export async function call<T = unknown>(service: string, method: string, args?: unknown): Promise<T> {
  try {
    if (isTauri) return await invoke<T>("svc_call", { service, method, args: args ?? null });
    return await mockCall<T>(service, method, args);
  } catch (e) {
    throw toBackendError(e);
  }
}

// ---- topics -----------------------------------------------------------------------------------

type Listener = (payload: unknown) => void;

interface TopicEntry {
  key: string;
  listeners: Set<Listener>;
  hasValue: boolean;
  value: unknown;
  /** Resolves to the teardown for the native/mock subscription. */
  ready: Promise<() => void>;
  /** Rust has counted this window's subscription (core.subscribe answered). */
  live: boolean;
}

const topics = new Map<string, TopicEntry>();

function dispatch(entry: TopicEntry, payload: unknown) {
  entry.hasValue = true;
  entry.value = payload;
  for (const l of [...entry.listeners]) l(payload);
}

function openTopic(service: string, topic: string): TopicEntry {
  const key = `${service}/${topic}`;
  const entry: TopicEntry = { key, listeners: new Set(), hasValue: false, value: undefined, ready: Promise.resolve(() => {}), live: false };
  if (isTauri) {
    entry.ready = (async () => {
      const unlisten = await listen(`svc://${key}`, (ev) => dispatch(entry, ev.payload));
      try {
        const last = await call<unknown>("core", "subscribe", { topic: key });
        entry.live = true;
        if (!entry.hasValue && last !== null && last !== undefined) dispatch(entry, last);
      } catch (e) {
        console.warn("subscribe failed", key, e);
      }
      return () => {
        unlisten();
        entry.live = false;
        call("core", "unsubscribe", { topic: key }).catch(() => {});
      };
    })();
  } else {
    const stop = mockSubscribe(service, topic, (payload) => dispatch(entry, payload));
    entry.ready = Promise.resolve(stop);
  }
  return entry;
}

/** Listens to `svc://service/topic`. Returns the unsubscribe function. */
export function on<T = unknown>(service: string, topic: string, cb: (payload: T) => void): () => void {
  const key = `${service}/${topic}`;
  let entry = topics.get(key);
  if (!entry) {
    entry = openTopic(service, topic);
    topics.set(key, entry);
  }
  const e = entry;
  const listener = cb as Listener;
  e.listeners.add(listener);
  if (e.hasValue) {
    const value = e.value;
    queueMicrotask(() => {
      if (e.listeners.has(listener)) listener(value);
    });
  }
  return () => {
    if (!e.listeners.delete(listener)) return;
    if (e.listeners.size === 0 && topics.get(key) === e) {
      topics.delete(key);
      void e.ready.then((stop) => stop());
    }
  };
}

/** The last value seen on a topic that is currently open (no subscription is made). */
export function peekTopic<T>(service: string, topic: string): T | undefined {
  const e = topics.get(`${service}/${topic}`);
  return e?.hasValue ? (e.value as T) : undefined;
}

/**
 * Called once at startup: drops subscriptions a previous page load left in Rust. Only the main
 * window may do this: Rust keeps one subscription table for every dock window, so an extra dock
 * starting on another display would otherwise cut the main window's live topics.
 */
export async function resetSubscriptions(): Promise<void> {
  if (!isTauri || !isMainWindow) return;
  await call("core", "reset_subscriptions").catch(() => {});
  // A reload of "main" also dropped what the other dock windows subscribed to: they subscribe
  // again to the topics their tiles still show (below), so their live tiles keep updating.
  await emit(SUBSCRIPTIONS_RESET, { at: Date.now() }).catch(() => {});
}

const SUBSCRIPTIONS_RESET = "glintbar://subscriptions-reset";

if (isTauri && !isMainWindow) {
  void listen(SUBSCRIPTIONS_RESET, () => {
    for (const entry of topics.values()) {
      if (entry.live) call("core", "subscribe", { topic: entry.key }).catch(() => {});
    }
  }).catch(() => {});
}

// ---- React hooks ------------------------------------------------------------------------------

/** Live topic value. Unsubscribes while the surrounding tile is off-screen or the dock is hidden. */
export function useTopic<T>(service: string, topic: string, opts: { enabled?: boolean } = {}): T | undefined {
  const visible = useIsVisible();
  const enabled = (opts.enabled ?? true) && visible;
  const [value, setValue] = useState<T | undefined>(() => peekTopic<T>(service, topic));
  useEffect(() => {
    if (!enabled) return;
    return on<T>(service, topic, (p) => setValue(() => p));
  }, [service, topic, enabled]);
  return value;
}

export interface ServiceState<T> {
  data: T | undefined;
  error: BackendError | undefined;
  loading: boolean;
  /** Unix ms of the last successful response. */
  updatedAt: number | undefined;
  refresh: () => void;
}

export interface ServiceOptions {
  /** Re-fetch every N ms while visible. */
  refreshMs?: number;
  enabled?: boolean;
}

/**
 * Calls `service.method(args)` on mount / when args change, and every `refreshMs` while visible.
 * Keeps the last good data when a refresh fails (`error` is set, `data` stays).
 */
export function useService<T>(service: string, method: string, args?: unknown, opts: ServiceOptions = {}): ServiceState<T> {
  const visible = useIsVisible();
  const enabled = (opts.enabled ?? true) && visible;
  const argsKey = JSON.stringify(args ?? null);
  const [state, setState] = useState<Omit<ServiceState<T>, "refresh">>({
    data: undefined,
    error: undefined,
    loading: enabled,
    updatedAt: undefined,
  });
  const seq = useRef(0);
  const lastFetch = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    lastFetch.current = Date.now();
    setState((s) => ({ ...s, loading: true }));
    call<T>(service, method, JSON.parse(argsKey))
      .then((data) => {
        if (id === seq.current) setState({ data, error: undefined, loading: false, updatedAt: Date.now() });
      })
      .catch((error: BackendError) => {
        if (id === seq.current) setState((s) => ({ ...s, error, loading: false }));
      });
  }, [service, method, argsKey]);

  useEffect(() => {
    if (!enabled) return;
    const refreshMs = opts.refreshMs;
    // Coming back on screen: fetch only if the data is older than one refresh period.
    const due = !refreshMs || Date.now() - lastFetch.current >= refreshMs || state.updatedAt === undefined;
    if (due) run();
    if (!refreshMs) return;
    const t = setInterval(run, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, enabled, opts.refreshMs]);

  return { ...state, refresh: run };
}
