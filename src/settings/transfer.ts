/**
 * Export / import of every setting (all store keys: layout, theme, widget configs). Secrets are
 * never in the store (Credential Manager), so a file is safe to keep or share.
 */
import { call, isTauri } from "../core/backend";
import { setStored } from "../core/store";

export interface SettingsFile {
  app: "glintbar";
  kind: "settings";
  version: string;
  exportedAt: string;
  keys: Record<string, unknown>;
}

/** Keys that describe this PC rather than the user's choices. */
const SKIP = new Set(["shell.geometry"]);

export async function buildExport(): Promise<SettingsFile> {
  const [all, info] = await Promise.all([
    call<Record<string, unknown>>("store", "all"),
    call<{ version: string }>("app", "info").catch(() => ({ version: "?" })),
  ]);
  const keys: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all ?? {})) if (!SKIP.has(k)) keys[k] = v;
  return { app: "glintbar", kind: "settings", version: info.version, exportedAt: new Date().toISOString(), keys };
}

/** Saves the export. Returns where it went (a path in GlintBar, the file name in a browser). */
export async function exportSettings(): Promise<{ path: string; folder?: string }> {
  const data = await buildExport();
  const json = JSON.stringify(data, null, 2);
  if (isTauri) return call<{ path: string; folder: string }>("appearance", "export_settings", { json });
  const name = `GlintBar settings ${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { path: name };
}

export function parseSettingsFile(text: string): SettingsFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't a GlintBar settings file: it doesn't contain valid JSON.");
  }
  const d = data as Partial<SettingsFile>;
  if (!d || typeof d !== "object" || d.app !== "glintbar" || d.kind !== "settings" || !d.keys || typeof d.keys !== "object") {
    throw new Error("The file doesn't look like a GlintBar settings export.");
  }
  return d as SettingsFile;
}

/** Writes every key from the file. Returns how many were restored. */
export function applySettingsFile(file: SettingsFile): number {
  let n = 0;
  for (const [k, v] of Object.entries(file.keys)) {
    if (SKIP.has(k) || typeof k !== "string" || k.length > 128) continue;
    setStored(k, v);
    n++;
  }
  return n;
}
