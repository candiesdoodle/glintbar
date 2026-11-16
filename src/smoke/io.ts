/** Files in %APPDATA%\\GlintBar\\smoke through the core `smoke` service (plain names only). */
import { call } from "../core/backend";

export async function readSmokeFile(name: string): Promise<string | null> {
  const text = await call<string | null>("smoke", "read", { name });
  if (text == null) return null;
  // PowerShell 5 writes a byte-order mark.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function writeSmokeFile(name: string, text: string, append = false): Promise<void> {
  await call("smoke", "write", { name, text, append });
}

export function writeSmokeJson(name: string, value: unknown): Promise<void> {
  return writeSmokeFile(name, JSON.stringify(value, null, 1));
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Writes `name` once things are quiet for `ms` (the value is read when the write happens). */
export function writeSoon(name: string, value: () => unknown, ms = 800): void {
  clearTimeout(timers.get(name));
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name);
      writeSmokeJson(name, value()).catch(() => {});
    }, ms),
  );
}

/** JSON preview cut to `max` characters. */
export function preview(value: unknown, max = 300): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? text.slice(0, max) + "…(" + text.length + " chars)" : text;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(what + " timed out after " + ms + " ms"), { code: "timeout" })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let quietUntil = 0;

/**
 * The harness's own polling (command.json every 300 ms, layout.json every 2 s) stops until
 * `ms` from now, so the driver's idle CPU measurement sees the app, not the harness.
 */
export function quietFor(ms: number): number {
  quietUntil = Date.now() + Math.max(0, Math.min(ms, 120_000));
  return quietUntil;
}

export function quietLeft(): number {
  return Math.max(0, quietUntil - Date.now());
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
