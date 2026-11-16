/**
 * Shared, demand-driven data sources for the AI tiles. Several tiles (Claude Usage, Claude Plan
 * Usage, AI Limits) read the same tool; a Source fetches once for all of them, only while at least
 * one visible tile or open card uses it, and keeps the last good reading across restarts (store key
 * "ai.last.<key>") so a closed tool or a reboot never blanks the tile.
 */
import { useEffect, useSyncExternalStore } from "react";
import { getStored, setStored } from "../../../core/store";
import { useIsVisible } from "../../../core/useVisible";

export interface SourceState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Unix ms of the last good data (may come from the previous run). */
  updatedAt: number | undefined;
  /** The data is the reading saved by an earlier run, not fetched yet in this one. */
  fromCache: boolean;
}

export interface SourceOptions<T> {
  key: string;
  fetch: () => Promise<T>;
  /** Milliseconds until the next refresh, decided after each fetch. */
  every: (state: SourceState<T>) => number;
  persist?: boolean;
  onData?: (data: T) => void;
}

export class Source<T> {
  private state: SourceState<T>;
  private listeners = new Set<() => void>();
  private users = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  /** Unix ms of the last fetch attempt. */
  lastFetch = 0;

  constructor(private readonly opts: SourceOptions<T>) {
    const saved = opts.persist ? getStored<{ data: T; at: number } | null>(`ai.last.${opts.key}`, null) : null;
    this.state = { data: saved?.data, error: undefined, loading: false, updatedAt: saved?.at, fromCache: Boolean(saved) };
  }

  getState = (): SourceState<T> => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts refreshing while held; returns the release function. */
  acquire(): () => void {
    this.users++;
    if (this.users === 1) this.plan(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users--;
      if (this.users === 0) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  /** Fetches now (also when nobody holds the source, e.g. "Check again"). */
  refresh(): Promise<void> {
    return this.run();
  }

  /** Fetches soon when someone is watching and the last fetch is at least `minAge` old. */
  nudge(minAge: number): void {
    if (this.users > 0 && !this.running && Date.now() - this.lastFetch >= minAge) void this.run();
  }

  /** Forgets the saved reading (e.g. after disconnecting a key). */
  forget(): void {
    if (this.opts.persist) setStored(`ai.last.${this.opts.key}`, null);
    this.set({ data: undefined, error: undefined, updatedAt: undefined, fromCache: false });
  }

  private set(patch: Partial<SourceState<T>>) {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private plan(initial: boolean) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.users === 0) return;
    const every = Math.max(5_000, this.opts.every(this.state));
    const wait = initial ? Math.max(0, this.lastFetch + every - Date.now()) : every;
    this.timer = setTimeout(() => void this.run(), wait);
  }

  private run(): Promise<void> {
    if (this.running) return this.running;
    this.lastFetch = Date.now();
    this.set({ loading: true });
    this.running = (async () => {
      try {
        const data = await this.opts.fetch();
        const at = Date.now();
        this.set({ data, error: undefined, loading: false, updatedAt: at, fromCache: false });
        if (this.opts.persist) setStored(`ai.last.${this.opts.key}`, { data, at });
        try {
          this.opts.onData?.(data);
        } catch (e) {
          console.warn("ai source onData failed", this.opts.key, e);
        }
      } catch (error) {
        this.set({ error, loading: false });
      } finally {
        this.running = undefined;
        this.plan(false);
      }
    })();
    return this.running;
  }
}

/** Subscribes a component to a Source; refreshing pauses while it is off-screen or disabled. */
export function useSource<T>(src: Source<T>, enabled = true): SourceState<T> & { refresh: () => void } {
  const visible = useIsVisible();
  const on = enabled && visible;
  const state = useSyncExternalStore(src.subscribe, src.getState);
  useEffect(() => (on ? src.acquire() : undefined), [src, on]);
  return { ...state, refresh: () => void src.refresh() };
}
