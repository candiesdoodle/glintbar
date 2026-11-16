/**
 * Persistent settings. Backed by the Rust `store` service (%APPDATA%\\GlintBar\\store.json) or
 * localStorage in the browser preview.
 *
 * - `useStored(key, fallback)`              a single persisted value (use for slice-local data;
 *                                           prefix keys with your domain: "media.lastPlayer")
 * - `createPersistedStore(key, defaults)`   a zustand store persisted as one key (dock layout,
 *                                           app settings)
 * - `useSettings`                           app-wide preferences (theme, accent, clock)
 */
import { useCallback, useSyncExternalStore } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { call, on } from "./backend";

const cache = new Map<string, unknown>();
const keyListeners = new Map<string, Set<() => void>>();
let loaded = false;
const hydrators: Array<() => void> = [];

function notify(key: string) {
  for (const l of keyListeners.get(key) ?? []) l();
}

/** Loads every key once at startup (before the first render). */
export async function loadStore(): Promise<void> {
  try {
    const all = await call<Record<string, unknown>>("store", "all");
    for (const [k, v] of Object.entries(all ?? {})) cache.set(k, v);
  } catch (e) {
    console.warn("could not load settings", e);
  }
  loaded = true;
  on<{ key: string; value: unknown }>("store", "changed", ({ key, value }) => {
    const prev = cache.get(key);
    if (JSON.stringify(prev) === JSON.stringify(value)) return;
    if (value === null || value === undefined) cache.delete(key);
    else cache.set(key, value);
    notify(key);
  });
  for (const h of hydrators) h();
}

export function getStored<T>(key: string, fallback: T): T {
  return cache.has(key) ? (cache.get(key) as T) : fallback;
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

/** Updates the cache now and persists shortly after (coalesces rapid changes like slider drags). */
export function setStored<T>(key: string, value: T): void {
  if (value === undefined || value === null) cache.delete(key);
  else cache.set(key, value);
  notify(key);
  clearTimeout(pendingWrites.get(key));
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      const op = value === undefined || value === null ? call("store", "delete", { key }) : call("store", "set", { key, value });
      op.catch((e) => console.warn("could not save", key, e));
    }, 150),
  );
}

export function subscribeKey(key: string, cb: () => void): () => void {
  let set = keyListeners.get(key);
  if (!set) keyListeners.set(key, (set = new Set()));
  set.add(cb);
  return () => set!.delete(cb);
}

/** A persisted value as React state. */
export function useStored<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    useCallback((cb) => subscribeKey(key, cb), [key]),
    () => getStored(key, fallback),
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = getStored(key, fallback);
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      setStored(key, resolved);
    },
    // fallback is intentionally not a dependency: callers pass literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}

/**
 * A zustand store saved under one store key. Saved values are shallow-merged over `defaults`,
 * so adding a field later needs no migration. Pass `migrate` for real shape changes.
 */
export function createPersistedStore<T extends object>(
  key: string,
  defaults: T,
  migrate?: (saved: Record<string, unknown>) => Partial<T>,
): UseBoundStore<StoreApi<T>> {
  const store = create<T>()(() => ({ ...defaults }));
  let applying = false;
  const hydrate = () => {
    const saved = getStored<Record<string, unknown> | undefined>(key, undefined);
    if (saved && typeof saved === "object") {
      applying = true;
      store.setState({ ...defaults, ...(migrate ? migrate(saved) : (saved as Partial<T>)) }, true);
      applying = false;
    }
  };
  if (loaded) hydrate();
  hydrators.push(hydrate);
  subscribeKey(key, () => {
    // An outside change (e.g. Rust or another window) - reload unless we caused it.
    const saved = getStored<unknown>(key, undefined);
    if (JSON.stringify(saved) !== JSON.stringify(store.getState())) hydrate();
  });
  store.subscribe((state) => {
    if (!applying) setStored(key, state);
  });
  return store;
}

// ---- app-wide settings --------------------------------------------------------------------------

export type ThemeId = "black" | "white" | "midnight" | "glass" | "ios-glass" | "clear";

export interface Settings {
  theme: ThemeId;
  /** CSS colour; empty = the theme's own accent. */
  accent: string;
  clock24h: boolean;
  showSeconds: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "midnight",
  accent: "",
  clock24h: !new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12,
  showSeconds: true,
};

export const useSettings = createPersistedStore<Settings>("settings", DEFAULT_SETTINGS);

export function updateSettings(patch: Partial<Settings>): void {
  useSettings.setState(patch);
}
