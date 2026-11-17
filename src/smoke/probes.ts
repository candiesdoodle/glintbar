/**
 * Round-two probes for the driver (scripts/smoke/drive.ps1): keyboard focus and typing, the
 * Apps tile, dock order, auto-hide / taskbar prefs, and live glass frames. Each export is one
 * command-channel action (see commands.ts); all of them read state back, none click anything.
 */
import { call } from "../core/backend";
import { updateSettings, useSettings, type ThemeId } from "../core/store";
import { dockActions, useDock } from "../dock/layout";
import { useShell } from "../dock/shell";
import { useDockUi } from "../dock/ui";
import { updateAppearance, updateDockPrefs, useAppearancePrefs, useDockPrefs, type DockPrefs } from "../settings/keys";
import { buildDockApps } from "../widgets/apps/shared/grouping";
import { closePopup, usePopup } from "../widgets/apps/shared/popups";
import type { Pin, WindowInfo } from "../widgets/apps/types";
import { todoActions, useTodos } from "../widgets/productivity/todos/store";
import { WINDOW_LABEL } from "../core/windowLabel";
import { sleep } from "./io";
import { screenMapper } from "./layout";

function arg<T>(args: unknown, key: string): T | undefined {
  if (args && typeof args === "object" && !Array.isArray(args)) return (args as Record<string, T>)[key];
  return undefined;
}

// ---- focus and typing -----------------------------------------------------------------------

function describeEl(el: Element | null) {
  if (!el || el === document.body) return null;
  const h = el as HTMLElement;
  return {
    tag: h.tagName.toLowerCase(),
    placeholder: (h as HTMLInputElement).placeholder ?? null,
    label: h.getAttribute("aria-label"),
    value: "value" in h ? String((h as HTMLInputElement).value) : null,
    panel: h.closest<HTMLElement>("[data-glintbar-panel]")?.dataset.glintbarPanel ?? null,
  };
}

/** Where keyboard focus is, and what the picker shows. */
export function focusInfo() {
  const picker = document.querySelector<HTMLElement>('[data-glintbar-panel="panel"]');
  const search = picker?.querySelector<HTMLInputElement>('input[aria-label="Search widgets"]') ?? null;
  const ui = useDockUi.getState();
  return {
    hasFocus: document.hasFocus(),
    visibilityState: document.visibilityState,
    active: describeEl(document.activeElement),
    panel: ui.panel,
    card: ui.card?.instanceId ?? null,
    picker: picker
      ? {
          query: search?.value ?? null,
          heading: picker.querySelector("header h2")?.textContent ?? null,
          summary: picker.querySelector("header p")?.textContent ?? null,
          cards: picker.querySelectorAll("section[data-section] .grid > *").length,
        }
      : null,
  };
}

export function todos() {
  return useTodos.getState().items.map((i) => ({ id: i.id, text: i.text, done: i.done }));
}

export function todosRemove(args: unknown) {
  const text = String(arg<string>(args, "text") ?? "");
  const hits = useTodos.getState().items.filter((i) => i.text === text);
  hits.forEach((i) => todoActions.remove(i.id));
  return { removed: hits.length };
}

// ---- dock order and prefs ---------------------------------------------------------------------

export function dockOrder() {
  return useDock.getState().instances.map((i) => ({ instanceId: i.instanceId, widgetId: i.widgetId }));
}

export function reorderDock(args: unknown) {
  const order = arg<string[]>(args, "order");
  if (!Array.isArray(order)) throw new Error("reorderDock needs order: instance ids");
  dockActions.reorder(order.map(String));
  return dockOrder();
}

const PREF_KEYS: Array<keyof DockPrefs> = ["lockDock", "taskbarMode", "showOnDesktop", "displays", "windowPreviews", "magnification", "magnifyScale", "fullWidthAlign"];

export function setDockPrefs(args: unknown) {
  const patch: Partial<DockPrefs> = {};
  if (args && typeof args === "object") {
    for (const k of PREF_KEYS) {
      const v = (args as Record<string, unknown>)[k];
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }
  }
  if (patch.taskbarMode !== undefined && !["hidden", "autohide", "leave"].includes(patch.taskbarMode)) throw new Error("taskbarMode must be hidden, autohide or leave");
  if (patch.displays !== undefined && !["main", "all", "follow"].includes(patch.displays)) throw new Error("displays must be main, all or follow");
  if (patch.fullWidthAlign !== undefined && !["left", "center", "right", "fill"].includes(patch.fullWidthAlign)) throw new Error("fullWidthAlign must be left, center, right or fill");
  if (patch.magnifyScale !== undefined) patch.magnifyScale = Math.max(1.2, Math.min(2, Number(patch.magnifyScale) || 1.5));
  updateDockPrefs(patch);
  const p = useDockPrefs.getState();
  return Object.fromEntries(PREF_KEYS.map((k) => [k, p[k]]));
}

/** Full width on/off and where its widgets sit (Settings > Dock > Align widgets). */
export async function setAlign(args: unknown) {
  const align = String(arg<string>(args, "align") ?? "left");
  if (!["left", "center", "right", "fill"].includes(align)) throw new Error("align must be left, center, right or fill");
  const fullWidth = arg<boolean>(args, "fullWidth");
  if (fullWidth !== undefined) dockActions.update({ fullWidth: Boolean(fullWidth), barWidth: 0 });
  updateDockPrefs({ fullWidthAlign: align as DockPrefs["fullWidthAlign"] });
  await sleep(400);
  const scroller = document.querySelector<HTMLElement>("[data-glintbar-bar] [role=toolbar]");
  return {
    fullWidth: useDock.getState().fullWidth,
    align: useDockPrefs.getState().fullWidthAlign,
    applied: scroller?.dataset.align ?? null,
    overflowing: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null,
  };
}

/**
 * The Apps tile's magnified icons as drawn (screen px): each copy's box and scale, the bar, and
 * what the driver needs to work out how far the biggest icon should rise above the bar.
 */
export async function magnifyState() {
  const m = await screenMapper();
  const bar = document.querySelector<HTMLElement>("[data-glintbar-bar]");
  const layer = document.querySelector<HTMLElement>("[data-glintbar-magnify]");
  const copies = layer
    ? [...layer.querySelectorAll<HTMLElement>("[data-mag-key]")].map((el) => {
        const r = el.getBoundingClientRect();
        const base = el.offsetHeight || r.height || 1;
        return { key: el.dataset.magKey ?? "", scale: Math.round((r.height / base) * 1000) / 1000, rect: m.rect(r) };
      })
    : [];
  const p = useDockPrefs.getState();
  const d = useDock.getState();
  return {
    magnification: p.magnification,
    magnifyScale: p.magnifyScale,
    sizePx: d.sizePx,
    padding: d.padding,
    edge: d.edge,
    scale: m.scale,
    bar: bar ? m.rect(bar.getBoundingClientRect()) : null,
    layer: Boolean(layer),
    copies,
  };
}

export function setAutoHide(args: unknown) {
  const on = Boolean(arg<boolean>(args, "on") ?? args);
  dockActions.update({ autoHide: on });
  return { autoHide: useDock.getState().autoHide };
}

/** Rust's view (shell.get_state) plus the page's. */
export async function shellState() {
  let rust: unknown = null;
  let error: string | null = null;
  try {
    rust = await call("shell", "get_state");
  } catch (e) {
    error = String(e);
  }
  const d = useDock.getState();
  return { visibility: useShell.getState().visibility, hidden: useDockUi.getState().hidden, edge: d.edge, autoHide: d.autoHide, prefs: useDockPrefs.getState(), rust, error };
}

// ---- the Apps tile ----------------------------------------------------------------------------

function appsInstance() {
  const tile = document.querySelector<HTMLElement>('[data-glintbar-tile^="apps.apps#"]');
  const id = tile?.dataset.glintbarTile;
  const inst = useDock.getState().instances.find((i) => i.instanceId === id);
  return { tile, inst };
}

/** Pins, the tile's items (screen points), which windows each has, and the open popup. */
export async function appsState() {
  const { tile, inst } = appsInstance();
  if (!tile || !inst) return { onDock: false };
  const m = await screenMapper();
  const pins = (inst.config.pins as Pin[] | undefined) ?? [];
  let windows: WindowInfo[] = [];
  let windowsError: string | null = null;
  try {
    windows = (await call<WindowInfo[]>("apps", "windows")) ?? [];
  } catch (e) {
    windowsError = String(e);
  }
  const apps = buildDockApps(pins, windows, { showRunning: inst.config.showRunning !== false });
  const byKey = new Map(apps.map((a) => [a.key, a]));
  const items = [...tile.querySelectorAll<HTMLElement>('[role="button"][aria-label]')]
    .filter((el) => el.dataset.appKey !== undefined || el.getAttribute("aria-label") === "Start")
    .map((el) => {
      const key = el.dataset.appKey ?? "__start";
      const app = byKey.get(key);
      return {
        key,
        label: el.getAttribute("aria-label") ?? "",
        ...m.center(el),
        pinned: Boolean(app?.pin || app?.group),
        running: Boolean(app && app.windows.length > 0),
        windows: (app?.windows ?? []).map((w) => ({ hwnd: w.hwnd, minimized: w.minimized, foreground: w.foreground, exe: w.exe ?? null, aumid: w.aumid ?? null })),
      };
    });
  const open = usePopup.getState().open;
  return {
    onDock: true,
    instanceId: inst.instanceId,
    pins: pins.map((p) => (p.kind === "group" ? { id: p.id, name: p.name, kind: p.kind } : { id: p.id, name: p.name, kind: p.kind, target: p.target, exe: p.exe ?? null, aumid: p.aumid ?? null })),
    items,
    windows: windows.map((w) => ({ hwnd: w.hwnd, title: w.title, exe: w.exe ?? null, aumid: w.aumid ?? null, minimized: w.minimized, foreground: w.foreground })),
    windowsError,
    popup: open ? { kind: open.kind, key: open.key } : null,
  };
}

/** Replaces the Apps tile's pins; returns the previous list (the driver restores it). */
export function appsSetPins(args: unknown) {
  const pins = arg<Pin[]>(args, "pins");
  if (!Array.isArray(pins)) throw new Error("appsSetPins needs pins");
  const { inst } = appsInstance();
  if (!inst) throw new Error("the Apps tile is not on the dock");
  const before = (inst.config.pins as Pin[] | undefined) ?? [];
  dockActions.setConfig(inst.instanceId, { pins });
  return { before, now: pins.length };
}

/** Puts `entry` first unless a pin with its id exists; returns the previous list. */
export function appsAddPin(args: unknown) {
  const entry = arg<Pin>(args, "entry");
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string") throw new Error("appsAddPin needs entry {id, name, kind, target, ...}");
  const { inst } = appsInstance();
  if (!inst) throw new Error("the Apps tile is not on the dock");
  const before = (inst.config.pins as Pin[] | undefined) ?? [];
  const has = before.some((p) => p.id === entry.id);
  if (!has) dockActions.setConfig(inst.instanceId, { pins: [entry, ...before] });
  return { before, added: !has };
}

export function appsClosePopup() {
  const was = usePopup.getState().open?.kind ?? null;
  closePopup();
  return { closed: was };
}

// ---- live glass -------------------------------------------------------------------------------

interface FrameRec {
  at: number;
  bytes: number;
  hash: string;
  width: number;
  height: number;
  /** Share of pixels that are clearly magenta (the driver's test window), 0-1; -1 not measured. */
  magenta: number;
}

const glass = {
  installed: false,
  frames: [] as FrameRec[],
  startedAt: 0,
  markAt: 0,
  saved: null as null | { theme: ThemeId; liveGlass: boolean; glassSource: "auto" | "wallpaper" },
};

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Share of clearly magenta pixels in a decoded frame (JPEG keeps 255,0,255 within ~40). */
function magentaShare(bmp: ImageBitmap): number {
  try {
    if (typeof OffscreenCanvas !== "function" || bmp.width < 1 || bmp.height < 1) return -1;
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let hit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 190 && px[i + 1] < 80 && px[i + 2] > 190) hit++;
    return hit / (px.length / 4);
  } catch {
    return -1;
  }
}

/**
 * Counts the JPEG frames the glass source decodes (sources.ts calls the global
 * createImageBitmap with an image/jpeg Blob for every frame), with a hash of the bytes and how
 * much of the picture is magenta. Smoke mode only.
 */
function installFrameCounter() {
  if (glass.installed || typeof window.createImageBitmap !== "function") return;
  glass.installed = true;
  const original = window.createImageBitmap.bind(window) as (...a: unknown[]) => Promise<ImageBitmap>;
  const wrapped = (...a: unknown[]): Promise<ImageBitmap> => {
    const p = original(...a);
    const src = a[0];
    if (src instanceof Blob && src.type === "image/jpeg") {
      const rec: FrameRec = { at: Date.now(), bytes: src.size, hash: "", width: 0, height: 0, magenta: -1 };
      glass.frames.push(rec);
      if (glass.frames.length > 1000) glass.frames.shift();
      src
        .arrayBuffer()
        .then((b) => (rec.hash = fnv1a(new Uint8Array(b))))
        .catch(() => {});
      // Registered before the caller's own then(), so the bitmap is still open here.
      p.then((bmp) => {
        rec.width = bmp.width;
        rec.height = bmp.height;
        rec.magenta = magentaShare(bmp);
      }).catch(() => {});
    }
    return p;
  };
  (window as unknown as { createImageBitmap: unknown }).createImageBitmap = wrapped;
}

async function affinity(): Promise<number | null> {
  try {
    const w = await call<{ native: { displayAffinity: number } | null }>("smoke", "window", { label: WINDOW_LABEL });
    return w?.native ? w.native.displayAffinity : null;
  } catch {
    return null;
  }
}

/** appearance.glass_state: tier, reason, resting + the Rust loop's diagnostics (framesSent, ...). */
async function glassState(): Promise<Record<string, unknown> | null> {
  try {
    return await call<Record<string, unknown> | null>("appearance", "glass_state");
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Live glass on, for real: lets Rust exclude the dock from capture for `seconds` (smoke-only
 * override; Rust re-checks it at once), then switches to a glass theme with live glass on, and
 * waits (up to 6 s) for the capture tier so the driver measures a settled state.
 */
export async function glassStart(args: unknown) {
  const theme = (arg<string>(args, "theme") ?? "glass") as ThemeId;
  const seconds = Number(arg<number>(args, "seconds")) || 20;
  installFrameCounter();
  const a = useAppearancePrefs.getState();
  glass.saved = { theme: useSettings.getState().theme, liveGlass: a.liveGlass, glassSource: a.glassSource };
  let granted: unknown = null;
  let overrideError: string | null = null;
  try {
    granted = await call("smoke", "capture_override", { seconds });
  } catch (e) {
    overrideError = String(e);
  }
  glass.frames = [];
  glass.startedAt = Date.now();
  glass.markAt = glass.startedAt;
  updateAppearance({ liveGlass: true, glassSource: "auto" });
  updateSettings({ theme });
  const t0 = Date.now();
  let state = await glassState();
  while (Date.now() - t0 < 6000 && !(state && state.tier === "capture")) {
    await sleep(250);
    state = await glassState();
  }
  return { theme, granted, overrideError, waitedMs: Date.now() - t0, state, saved: glass.saved };
}

/** Frames since glassStart (and since the last mark, when `mark` is set the mark moves to now). */
export async function glassStats(args?: unknown) {
  const now = Date.now();
  const frames = glass.frames.filter((f) => f.at >= glass.startedAt);
  const sinceMark = frames.filter((f) => f.at >= glass.markAt).length;
  if (arg<boolean>(args, "mark")) glass.markAt = now;
  const hashes = new Set(frames.map((f) => f.hash).filter(Boolean));
  const sizes = [...new Set(frames.map((f) => f.width + "x" + f.height))];
  const measured = frames.filter((f) => f.magenta >= 0);
  return {
    frames: frames.length,
    framesSinceMark: sinceMark,
    distinctHashes: hashes.size,
    sizes,
    bytes: frames.length ? Math.round(frames.reduce((s, f) => s + f.bytes, 0) / frames.length) : 0,
    magentaFrames: measured.filter((f) => f.magenta >= 0.01).length,
    magentaMax: measured.length ? Math.round(Math.max(...measured.map((f) => f.magenta)) * 1000) / 1000 : -1,
    last: frames.slice(-6).map((f) => ({ ms: f.at - glass.startedAt, hash: f.hash, size: f.width + "x" + f.height, bytes: f.bytes, magenta: Math.round(f.magenta * 1000) / 1000 })),
    status: await glassState(),
    affinity: await affinity(),
    liveGlass: useAppearancePrefs.getState().liveGlass,
    theme: useSettings.getState().theme,
  };
}

/** Live glass off (the dock must show in captures again) and the override closed. */
export async function glassStop() {
  updateAppearance({ liveGlass: false, glassSource: glass.saved?.glassSource ?? "auto" });
  try {
    await call("smoke", "capture_override", { seconds: 0 });
  } catch {
    /* an older build: nothing to close */
  }
  await sleep(1500);
  return { affinity: await affinity(), state: await glassState(), saved: glass.saved };
}

export async function allowLaunch(args: unknown) {
  const seconds = Number(arg<number>(args, "seconds")) || 0;
  return { seconds: await call("smoke", "allow_launch", { seconds }) };
}
