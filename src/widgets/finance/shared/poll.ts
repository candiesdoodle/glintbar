/**
 * A cached, deduplicated poller for account widgets.
 *
 * - One fetch per key no matter how many tiles/cards show it (Stripe and Stripe Chart share one).
 * - Refreshes every `refreshMs` only while at least one visible tile or card uses the key.
 * - Failures back off (30 s, 1 m, 2 m ... up to refreshMs); rejected keys wait a full period.
 * - The last good value is kept (and persisted with `persist`) so an offline dock still shows numbers.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { BackendError } from "../../../core/backend";
import { describeError, HttpError } from "../../../core/http";
import { getStored, setStored } from "../../../core/store";
import { useIsVisible } from "../../../core/useVisible";

/** An error whose message is already plain language for the user. */
export class PlainError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent = true) {
    super(message);
    this.name = "PlainError";
    this.permanent = permanent;
  }
}

export interface PollState<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  updatedAt?: number;
}

export interface Polled<T> extends PollState<T> {
  refresh: () => void;
  /** A refresh failed but older data is shown. */
  stale: boolean;
  /** Plain-language error text, if any. */
  message?: string;
}

interface Entry<T> {
  key: string;
  state: PollState<T>;
  failures: number;
  nextAt: number;
  timer?: ReturnType<typeof setTimeout>;
  active: number;
  listeners: Set<() => void>;
  fetcher: () => Promise<T>;
  refreshMs: number;
  persist: boolean;
  running: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entries = new Map<string, Entry<any>>();

/** "finance.stripe" -> "finance.cache.stripe" (store keys are prefixed with the domain). */
export function cacheKey(key: string): string {
  const i = key.indexOf(".");
  return i < 0 ? `${key}.cache` : `${key.slice(0, i)}.cache.${key.slice(i + 1)}`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof PlainError) return e.message;
  if (e instanceof HttpError || e instanceof BackendError) return describeError(e);
  if (e instanceof Error && e.message) return e.message;
  return describeError(e);
}

function isPermanent(e: unknown): boolean {
  if (e instanceof PlainError) return e.permanent;
  if (e instanceof HttpError) return ["unauthorized", "forbidden", "not_found", "not_connected"].includes(e.kind);
  if (e instanceof BackendError) return ["missing_secret", "denied", "bad_args"].includes(e.code);
  return false;
}

export function backoffMs(e: unknown, failures: number, refreshMs: number): number {
  if (isPermanent(e)) return refreshMs;
  const base = e instanceof HttpError && e.kind === "rate_limited" ? 120_000 : 30_000;
  return Math.min(refreshMs, base * 2 ** Math.max(0, failures - 1));
}

function getEntry<T>(key: string, refreshMs: number, persist: boolean, fetcher: () => Promise<T>): Entry<T> {
  let e = entries.get(key) as Entry<T> | undefined;
  if (!e) {
    const saved = persist ? getStored<{ data: T; at: number } | undefined>(cacheKey(key), undefined) : undefined;
    e = {
      key,
      state: saved ? { data: saved.data, updatedAt: saved.at, loading: false } : { loading: false },
      failures: 0,
      nextAt: saved ? saved.at + refreshMs : 0,
      active: 0,
      listeners: new Set(),
      fetcher,
      refreshMs,
      persist,
      running: false,
    };
    entries.set(key, e);
  }
  e.refreshMs = refreshMs;
  e.persist = persist;
  return e;
}

function set<T>(e: Entry<T>, patch: Partial<PollState<T>>) {
  e.state = { ...e.state, ...patch };
  for (const l of [...e.listeners]) l();
}

function schedule<T>(e: Entry<T>) {
  clearTimeout(e.timer);
  e.timer = undefined;
  if (e.active <= 0) return;
  const delay = Math.max(0, e.nextAt - Date.now());
  // setTimeout overflows past ~24.8 days; our periods are minutes.
  e.timer = setTimeout(() => void run(e), Math.min(delay, 2 ** 31 - 1));
}

async function run<T>(e: Entry<T>): Promise<void> {
  if (e.running) return;
  e.running = true;
  set(e, { loading: true });
  try {
    const data = await e.fetcher();
    const at = Date.now();
    e.failures = 0;
    e.nextAt = at + e.refreshMs;
    set(e, { data, error: undefined, loading: false, updatedAt: at });
    if (e.persist) setStored(cacheKey(e.key), { data, at });
  } catch (err) {
    e.failures += 1;
    e.nextAt = Date.now() + backoffMs(err, e.failures, e.refreshMs);
    set(e, { error: err, loading: false });
  } finally {
    e.running = false;
    schedule(e);
  }
}

/** Forget cached values whose key starts with `prefix` (after a disconnect). */
export function resetPolled(prefix: string): void {
  for (const [key, e] of entries) {
    if (key === prefix || key.startsWith(prefix + ".") || key.startsWith(prefix + ":")) {
      clearTimeout(e.timer);
      e.state = { loading: false };
      e.nextAt = 0;
      e.failures = 0;
      for (const l of [...e.listeners]) l();
      if (e.persist) setStored(cacheKey(key), null);
    }
  }
}

const EMPTY: PollState<never> = { loading: false };

/**
 * Polls `fetcher` under `key` every `refreshMs` while visible. `key = null` disables it
 * (sample mode). The key must change whenever the fetcher's inputs change.
 */
export function usePolled<T>(key: string | null, fetcher: () => Promise<T>, opts: { refreshMs: number; persist?: boolean }): Polled<T> {
  const visible = useIsVisible();
  const persist = opts.persist ?? true;
  const entry = key ? getEntry<T>(key, opts.refreshMs, persist, fetcher) : undefined;
  if (entry) entry.fetcher = fetcher;

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!entry) return () => {};
      entry.listeners.add(cb);
      return () => entry.listeners.delete(cb);
    },
    [entry],
  );
  const state = useSyncExternalStore(subscribe, () => (entry ? entry.state : (EMPTY as PollState<T>)));

  useEffect(() => {
    if (!entry || !visible) return;
    entry.active += 1;
    if (Date.now() >= entry.nextAt && !entry.running) void run(entry);
    else if (!entry.timer) schedule(entry);
    return () => {
      entry.active -= 1;
      if (entry.active <= 0) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
    };
  }, [entry, visible]);

  const refresh = useCallback(() => {
    if (!entry) return;
    entry.nextAt = 0;
    void run(entry);
  }, [entry]);

  return {
    ...state,
    refresh,
    stale: Boolean(state.error && state.data !== undefined),
    message: state.error ? errorMessage(state.error) : undefined,
  };
}
