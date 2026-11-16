/**
 * Captures every console error/warning, uncaught error and unhandled rejection of the webview
 * into smoke/console.json. Installed before the first render.
 */
import { writeSoon } from "./io";

export type ConsoleLevel = "error" | "warn" | "uncaught" | "rejection";

export interface ConsoleEntry {
  at: number;
  level: ConsoleLevel;
  text: string;
}

const MAX_ENTRIES = 3000;
const MAX_TEXT = 2000;

export const consoleEntries: ConsoleEntry[] = [];
let dropped = 0;
let installed = false;

export function formatValue(v: unknown): string {
  if (v instanceof Error) {
    const code = (v as { code?: unknown }).code;
    const head = v.name + (code ? "(" + String(code) + ")" : "") + ": " + v.message;
    const stack = v.stack ? v.stack.split("\n").slice(1, 6).join("\n") : "";
    return stack ? head + "\n" + stack : head;
  }
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function record(level: ConsoleLevel, text: string) {
  if (consoleEntries.length >= MAX_ENTRIES) {
    dropped++;
    return;
  }
  consoleEntries.push({ at: Date.now(), level, text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text });
  writeSoon("console.json", consoleSnapshot, 1000);
}

export function consoleSnapshot() {
  const count = (l: ConsoleLevel) => consoleEntries.filter((e) => e.level === l).length;
  return {
    counts: { error: count("error"), warn: count("warn"), uncaught: count("uncaught"), rejection: count("rejection"), dropped },
    entries: consoleEntries,
  };
}

export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        record(level, args.map(formatValue).join(" "));
      } catch {
        /* never break logging */
      }
      original(...args);
    };
  }
  window.addEventListener("error", (e) => {
    const where = e.filename ? " at " + e.filename + ":" + e.lineno + ":" + e.colno : "";
    record("uncaught", (e.error ? formatValue(e.error) : e.message) + where);
  });
  window.addEventListener("unhandledrejection", (e) => record("rejection", formatValue(e.reason)));
}
