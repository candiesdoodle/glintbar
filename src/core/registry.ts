/**
 * Discovers every widget: `src/widgets/<domain>/<name>/index.tsx` (default export).
 *
 * Widgets are code-split: each folder is its own chunk, loaded on demand. Start-up loads only
 * the widgets on the dock (`loadWidgets`), the picker loads the rest (`loadAllWidgets`).
 * `getWidget` answers synchronously for loaded widgets; `useWidget` loads and re-renders.
 */
import { useEffect, useSyncExternalStore } from "react";
import { CATEGORIES, type Category, type WidgetDef } from "./widget";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWidget = WidgetDef<any>;
type Loader = () => Promise<{ default: AnyWidget }>;

const modules = import.meta.glob<{ default: AnyWidget }>("../widgets/*/*/index.tsx");

export interface WidgetProblem {
  path: string;
  message: string;
}

export const widgetProblems: WidgetProblem[] = [];

const loaders = new Map<string, { path: string; load: Loader }>();
for (const [path, load] of Object.entries(modules)) {
  const m = /\.\.\/widgets\/([^/]+)\/([^/]+)\/index\.tsx$/.exec(path);
  if (m) loaders.set(`${m[1]}.${m[2]}`, { path, load });
}

/** Every widget id that exists (loaded or not). */
export const widgetIds: string[] = [...loaders.keys()];

const loaded = new Map<string, AnyWidget>();
const pending = new Map<string, Promise<AnyWidget | undefined>>();
/** Ids whose load finished, loaded or failed. */
const settled = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const l of [...listeners]) l();
}

function problem(path: string, message: string) {
  widgetProblems.push({ path, message });
  console.error(`[widgets] ${path}: ${message}`);
}

function accept(id: string, path: string, def: AnyWidget | undefined): AnyWidget | undefined {
  if (!def || typeof def !== "object" || !def.Tile) {
    problem(path, "index.tsx must default-export defineWidget({...})");
    return undefined;
  }
  if (def.id !== id) problem(path, `id is "${def.id}", expected "${id}"`);
  if (!CATEGORIES.includes(def.category)) problem(path, `unknown category "${def.category}"`);
  return def;
}

export function isKnownWidget(id: string): boolean {
  return loaders.has(id);
}

/** A loaded widget, or undefined (not loaded yet, or no such widget). */
export function getWidget(id: string): AnyWidget | undefined {
  return loaded.get(id);
}

export function loadWidget(id: string): Promise<AnyWidget | undefined> {
  const have = loaded.get(id);
  if (have) return Promise.resolve(have);
  const entry = loaders.get(id);
  if (!entry) return Promise.resolve(undefined);
  let p = pending.get(id);
  if (!p) {
    p = entry
      .load()
      .then((mod) => {
        const def = accept(id, entry.path, mod.default);
        if (def) loaded.set(id, def);
        return def;
      })
      .catch((e) => {
        problem(entry.path, `failed to load: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      })
      .finally(() => {
        pending.delete(id);
        if (!settled.has(id)) {
          settled.add(id);
          changed();
        }
      });
    pending.set(id, p);
  }
  return p;
}

export async function loadWidgets(ids: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(ids)].map((id) => loadWidget(id)));
}

function sortWidgets(list: AnyWidget[]): AnyWidget[] {
  return list.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
}

let all: AnyWidget[] | undefined;
let allAt = -1;

/** Every loaded widget, sorted by category then name. */
export function loadedWidgets(): AnyWidget[] {
  if (!all || allAt !== version) {
    all = sortWidgets([...loaded.values()]);
    allAt = version;
  }
  return all;
}

/** Loads every widget (the picker, search). */
export async function loadAllWidgets(): Promise<AnyWidget[]> {
  await loadWidgets(widgetIds);
  return loadedWidgets();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The widget, loading it if needed (re-renders once it is there). */
export function useWidget(id: string): AnyWidget | undefined {
  const def = useSyncExternalStore(subscribe, () => loaded.get(id));
  useEffect(() => {
    if (!def) void loadWidget(id);
  }, [def, id]);
  return def;
}

/** Every widget once all are loaded; undefined while loading. */
export function useAllWidgets(): AnyWidget[] | undefined {
  useSyncExternalStore(subscribe, () => version);
  const done = settled.size >= widgetIds.length;
  useEffect(() => {
    if (!done) void loadAllWidgets();
  }, [done]);
  return done ? loadedWidgets() : undefined;
}

export function widgetsByCategory(list: AnyWidget[]): Array<[Category, AnyWidget[]]> {
  const groups = new Map<Category, AnyWidget[]>();
  for (const w of list) {
    const g = groups.get(w.category) ?? [];
    g.push(w);
    groups.set(w.category, g);
  }
  return CATEGORIES.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!]);
}

export function searchWidgets(query: string, list: AnyWidget[]): AnyWidget[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const words = q.split(/\s+/);
  return list.filter((w) => {
    const hay = [w.name, w.description, w.category, ...(w.keywords ?? [])].join(" ").toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}
