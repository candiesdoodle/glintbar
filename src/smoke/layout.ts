/**
 * smoke/layout.json: where everything is on screen, in PHYSICAL screen pixels, so the PowerShell
 * driver can move the real mouse. Rewritten whenever the layout or the open UI changes.
 *
 * Screen point = window inner (client) position from Rust + CSS px × scale factor.
 */
import { call } from "../core/backend";
import { getWidget } from "../core/registry";
import { useSettings } from "../core/store";
import { WINDOW_LABEL } from "../core/windowLabel";
import { useDock } from "../dock/layout";
import { useShell } from "../dock/shell";
import { useDockUi } from "../dock/ui";
import { quietLeft, writeSmokeJson } from "./io";

export interface NativeInfo {
  hwnd: number;
  displayAffinity: number;
  exStyle: number;
  style: number;
  visible: boolean;
  rect: [number, number, number, number];
  regionKind: number;
  regionBox: [number, number, number, number];
}

export interface WindowRect {
  label: string;
  visible: boolean;
  scale: number;
  outerX: number;
  outerY: number;
  outerWidth: number;
  outerHeight: number;
  innerX: number;
  innerY: number;
  innerWidth: number;
  innerHeight: number;
  native: NativeInfo | null;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface TileLayout {
  instanceId: string;
  widgetId: string;
  name: string | null;
  rect: ScreenRect;
  /** A point on the tile that is not a button/link inside it (clicking it opens the card), or null. */
  click: ScreenPoint | null;
  hasCard: boolean;
  /** The error boundary's "!" is showing. */
  crashed: boolean;
}

/** Pointer presses the page saw (the click-through test expects none for clicks beside the dock). */
export const pointer = { downs: 0, last: null as null | { x: number; y: number; button: number; at: number; target: string } };

export function installPointerCounter(): void {
  document.addEventListener(
    "pointerdown",
    (e) => {
      pointer.downs++;
      const t = e.target as HTMLElement | null;
      const desc = t ? t.tagName.toLowerCase() + (t.closest("[data-glintbar-tile]") ? " in " + (t.closest("[data-glintbar-tile]") as HTMLElement).dataset.glintbarTile : "") : "";
      pointer.last = { x: e.screenX, y: e.screenY, button: e.button, at: Date.now(), target: desc };
    },
    true,
  );
}

const INTERACTIVE =
  "button, a[href], input, select, textarea, [role=button], [role=slider], [role=switch], [role=checkbox], [role=menuitem], [contenteditable=true]";

/** A spot on the tile whose click reaches the tile itself (opens its card), avoiding inner buttons. */
export function findClickPoint(el: HTMLElement): { x: number; y: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  const rows = [0.5, 0.3, 0.7, 0.15, 0.85, 0.06, 0.94];
  const cols = [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92, 0.03, 0.97];
  for (const fy of rows) {
    for (const fx of cols) {
      const x = r.left + fx * r.width;
      const y = r.top + fy * r.height;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!hit || !el.contains(hit)) continue;
      const inner = hit.closest(INTERACTIVE);
      if (inner && inner !== el && el.contains(inner)) continue;
      return { x, y };
    }
  }
  return null;
}

/** An empty spot on the bar (not a tile): right-click there opens the dock menu. */
function findBarPoint(bar: HTMLElement): { x: number; y: number } | null {
  const r = bar.getBoundingClientRect();
  const ys = [r.top + r.height / 2, r.top + 3, r.bottom - 3];
  for (const strict of [true, false]) {
    for (const y of ys) {
      for (let x = r.left + 2; x < r.right - 2; x += 2) {
        const hit = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!hit || !bar.contains(hit)) continue;
        if (hit.closest("[data-glintbar-tile]")) continue;
        if (strict && hit.closest("[data-glintbar-handle], button")) continue;
        return { x, y };
      }
    }
  }
  return null;
}

let lastWindow: WindowRect | null = null;

async function windowRect(): Promise<WindowRect | null> {
  try {
    lastWindow = await call<WindowRect>("smoke", "window", { label: WINDOW_LABEL });
  } catch {
    /* keep the last one */
  }
  return lastWindow;
}

export interface ScreenMapper {
  win: WindowRect | null;
  scale: number;
  /** Client CSS px -> physical screen px. */
  pt: (x: number, y: number) => ScreenPoint;
  rect: (r: DOMRect) => ScreenRect;
  /** The centre of an element on screen. */
  center: (el: Element) => ScreenPoint;
}

/** Client (CSS px) to screen (physical px) conversion for the current window position. */
export async function screenMapper(): Promise<ScreenMapper> {
  const win = await windowRect();
  const scale = win?.scale || window.devicePixelRatio || 1;
  const ox = win ? win.innerX : Math.round(window.screenX * scale);
  const oy = win ? win.innerY : Math.round(window.screenY * scale);
  const pt = (x: number, y: number): ScreenPoint => ({ x: Math.round(ox + x * scale), y: Math.round(oy + y * scale) });
  const rect = (r: DOMRect): ScreenRect => ({
    x: Math.round(ox + r.left * scale),
    y: Math.round(oy + r.top * scale),
    width: Math.round(r.width * scale),
    height: Math.round(r.height * scale),
  });
  const center = (el: Element) => {
    const r = el.getBoundingClientRect();
    return pt(r.left + r.width / 2, r.top + r.height / 2);
  };
  return { win, scale, pt, rect, center };
}

const TEXT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

/** Visible text fields inside panels and cards (the driver clicks and types into them). */
function textInputs(m: ScreenMapper) {
  const out: Array<{ panel: string; tag: string; placeholder: string; label: string; value: string; focused: boolean } & ScreenPoint> = [];
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-glintbar-panel] input, [data-glintbar-panel] textarea")) {
    if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    out.push({
      panel: el.closest<HTMLElement>("[data-glintbar-panel]")?.dataset.glintbarPanel ?? "",
      tag: el.tagName.toLowerCase(),
      placeholder: el.placeholder ?? "",
      label: el.getAttribute("aria-label") ?? "",
      value: el.value,
      focused: document.activeElement === el,
      ...m.center(el),
    });
    if (out.length >= 20) break;
  }
  return out;
}

/** Buttons of popups other than the dock menu (the Apps tile's menu, previews, ...). */
function popupItems(m: ScreenMapper) {
  const out: Array<{ panel: string; label: string } & ScreenPoint> = [];
  for (const p of document.querySelectorAll<HTMLElement>("[data-glintbar-panel]")) {
    const id = p.dataset.glintbarPanel ?? "";
    if (id === "menu" || id === "panel" || id === "card") continue;
    for (const b of p.querySelectorAll<HTMLElement>("button, [role^=menuitem]")) {
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({ panel: id, label: (b.textContent ?? b.getAttribute("aria-label") ?? "").trim().slice(0, 80), ...m.center(b) });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

export async function computeLayout(reason: string) {
  const m = await screenMapper();
  const { win, scale, pt, rect } = m;

  const dock = useDock.getState();
  const settings = useSettings.getState();
  const ui = useDockUi.getState();
  const shell = useShell.getState();
  const byId = new Map(dock.instances.map((i) => [i.instanceId, i]));

  const bar = document.querySelector<HTMLElement>("[data-glintbar-bar]");
  const tiles: TileLayout[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-glintbar-bar] [data-glintbar-tile]")) {
    const instanceId = el.dataset.glintbarTile ?? "";
    const widgetId = byId.get(instanceId)?.widgetId ?? instanceId.split("#")[0];
    const def = getWidget(widgetId);
    const c = findClickPoint(el);
    tiles.push({
      instanceId,
      widgetId,
      name: def?.name ?? null,
      rect: rect(el.getBoundingClientRect()),
      click: c ? pt(c.x, c.y) : null,
      hasCard: Boolean(def && (def.Card || def.connect || def.Connect)),
      crashed: Boolean(el.querySelector('[title$=" stopped working"]')),
    });
  }
  const barFree = bar ? findBarPoint(bar) : null;

  const panels = [...document.querySelectorAll<HTMLElement>("[data-glintbar-panel]")].map((p) => ({
    id: p.dataset.glintbarPanel ?? "",
    instanceId: p.dataset.glintbarInstance ?? null,
    rect: rect(p.getBoundingClientRect()),
  }));
  const menuItems = [...document.querySelectorAll<HTMLElement>('[data-glintbar-panel="menu"] [role^="menuitem"]')].map((b) => {
    const r = b.getBoundingClientRect();
    return { label: (b.textContent ?? "").trim(), ...pt(r.left + r.width / 2, r.top + r.height / 2) };
  });
  const settingsNav = [...document.querySelectorAll<HTMLElement>('[data-glintbar-panel="panel"] nav[aria-label="Settings sections"] button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { label: (b.textContent ?? "").trim(), current: b.getAttribute("aria-current") === "page", ...pt(r.left + r.width / 2, r.top + r.height / 2) };
  });
  const cardInst = ui.card ? byId.get(ui.card.instanceId) : undefined;

  return {
    at: new Date().toISOString(),
    reason,
    label: WINDOW_LABEL,
    devicePixelRatio: window.devicePixelRatio,
    scale,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    window: win,
    theme: settings.theme,
    edge: dock.edge,
    sizePreset: dock.sizePreset,
    sizePx: dock.sizePx,
    fullWidth: dock.fullWidth,
    spacing: dock.spacing,
    padding: dock.padding,
    distance: dock.distance,
    visibility: shell.visibility,
    bar: bar ? rect(bar.getBoundingClientRect()) : null,
    barFreePoint: barFree ? pt(barFree.x, barFree.y) : null,
    tiles,
    ui: {
      card: ui.card ? { instanceId: ui.card.instanceId, widgetId: cardInst?.widgetId ?? null } : null,
      menu: Boolean(ui.menu),
      panel: ui.panel,
      settingsSection: ui.settingsSection,
      hidden: ui.hidden,
    },
    panels,
    menuItems,
    settingsNav,
    inputs: textInputs(m),
    popupItems: popupItems(m),
    pointer: { ...pointer },
  };
}

export type Layout = Awaited<ReturnType<typeof computeLayout>>;

let lastKey = "";
let seq = 0;

/** Computes and writes layout.json; returns what was written. */
export async function dumpLayout(reason: string, force = true): Promise<Layout & { seq: number }> {
  const layout = await computeLayout(reason);
  const { at: _at, reason: _r, pointer: _p, ...stable } = layout;
  const key = JSON.stringify(stable);
  const out = { ...layout, seq: seq + 1 };
  if (force || key !== lastKey) {
    lastKey = key;
    seq = out.seq;
    await writeSmokeJson("layout.json", out).catch(() => {});
  }
  return out;
}

let watching = false;

/**
 * Rewrites layout.json when the dock state or the open UI changes, and every 2 s if anything
 * moved (window moves have no DOM event). Smoke mode only.
 */
export function watchLayout(): void {
  if (watching) return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (why: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (quietLeft() === 0) void dumpLayout(why, false);
    }, 350);
  };
  useDock.subscribe(() => soon("dock"));
  useDockUi.subscribe(() => soon("ui"));
  useSettings.subscribe(() => soon("settings"));
  useShell.subscribe(() => soon("shell"));
  window.addEventListener("resize", () => soon("resize"));
  setInterval(() => {
    if (quietLeft() === 0) void dumpLayout("poll", false);
  }, 2000);
}
