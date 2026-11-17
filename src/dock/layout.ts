/**
 * Dock layout: which widgets are on the dock (in order) and how the bar looks/sits.
 * Persisted under the store key "dock".
 */
import { createPersistedStore } from "../core/store";
import type { WidgetConfig } from "../core/widget";

export interface WidgetInstance {
  instanceId: string;
  widgetId: string;
  config: WidgetConfig;
}

export type Edge = "top" | "bottom";
export type SizePreset = "s" | "m" | "l" | "custom";

export interface DockState {
  instances: WidgetInstance[];
  edge: Edge;
  sizePreset: SizePreset;
  /** Tile height in CSS px. */
  sizePx: number;
  /** Gap between tiles. */
  spacing: number;
  /** Space between the bar's edge and its tiles. */
  padding: number;
  /** Span the whole screen edge instead of a centred pill. */
  fullWidth: boolean;
  /** Gap between the bar and the screen edge. */
  distance: number;
  autoHide: boolean;
  hideTaskbar: boolean;
  /** Keep maximised windows from covering the dock. */
  reserveSpace: boolean;
  /** Device name of the monitor the dock was last dragged to ("" = the primary one). */
  monitor: string;
  /** A narrowed pill's width in CSS px (dragging either end); 0 = fit the widgets. */
  barWidth: number;
}

export const SIZE_PRESETS: Record<Exclude<SizePreset, "custom">, number> = { s: 34, m: 44, l: 58 };
export const SIZE_RANGE = { min: 26, max: 120 };

let counter = 0;
export function newInstanceId(widgetId: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${widgetId}#${Date.now().toString(36)}${counter.toString(36)}`;
}

/** The first-run dock (and Settings > General > Reset layout): a taskbar plus a few live tiles. */
export const DEFAULT_WIDGETS = [
  "apps.apps",
  "media.nowplaying",
  "weather.now",
  "productivity.calendar",
  "system.cpu",
  "system.ram",
  "system.network",
  "system.quick-toggles",
  "system.tray",
  "clocks.clock",
];

export const DEFAULT_DOCK: DockState = {
  instances: DEFAULT_WIDGETS.map((widgetId) => ({ instanceId: `${widgetId}#default`, widgetId, config: {} })),
  edge: "bottom",
  sizePreset: "m",
  sizePx: SIZE_PRESETS.m,
  spacing: 6,
  padding: 6,
  fullWidth: false,
  distance: 6,
  autoHide: false,
  hideTaskbar: true,
  reserveSpace: true,
  monitor: "",
  barWidth: 0,
};

export const useDock = createPersistedStore<DockState>("dock", DEFAULT_DOCK);

/** Height of the strip the window reserves at the screen edge, in CSS px. */
export function stripThickness(s: Pick<DockState, "sizePx" | "padding" | "distance">): number {
  // +2 for the bar's 1px border on both sides.
  return Math.round(s.sizePx + 2 * s.padding + s.distance + 2);
}

/** The narrowest a pill may get: one square tile plus the bar's padding and border. */
export function minBarWidth(s: Pick<DockState, "sizePx" | "padding">): number {
  return Math.round(s.sizePx + 2 * s.padding + 2);
}

/** Width after dragging an end of a centred bar by `dx` (both ends move, so twice `dx`). */
export function narrowedWidth(start: number, dx: number, side: "left" | "right", min: number, natural: number): number {
  const grown = start + 2 * (side === "right" ? dx : -dx);
  const w = Math.max(min, Math.min(natural, grown));
  // Back at (or past) the natural width: "fit the widgets" again.
  return w >= natural - 1 ? 0 : Math.round(w);
}

// ---- drag-to-reorder maths (pure, tested) -----------------------------------------------------

export interface SlotRect {
  left: number;
  width: number;
}

/** Where the dragged tile goes among `order`: before the first tile whose centre is past it. */
export function reorderFor(order: string[], rects: Map<string, SlotRect>, id: string, dx: number): string[] {
  const me = rects.get(id);
  if (!me) return order;
  const center = me.left + me.width / 2 + dx;
  const others = order.filter((o) => o !== id);
  const at = others.filter((o) => {
    const r = rects.get(o);
    return r ? r.left + r.width / 2 < center : false;
  }).length;
  return [...others.slice(0, at), id, ...others.slice(at)];
}

/** Width of a row of tiles laid out with `spacing` between them. */
export function rowWidth(ids: string[], rects: Map<string, SlotRect>, spacing: number): number {
  const widths = ids.map((id) => rects.get(id)?.width).filter((v): v is number => v !== undefined);
  return widths.reduce((s, w) => s + w, 0) + Math.max(0, widths.length - 1) * spacing;
}

/**
 * How much of the free space sits before the tiles: 0 left (or overflowing), 0.5 centre, 1 right.
 * Fill has no free space; a tile lifted off it closes the gap towards the centre, like centre.
 */
export function alignFactor(align: "left" | "center" | "right" | "fill", overflowing: boolean): number {
  if (overflowing) return 0;
  return align === "center" || align === "fill" ? 0.5 : align === "right" ? 1 : 0;
}

/**
 * Fill: how far a stretched tile's content moves in from each side so it keeps its natural width,
 * centred. Whole px, rounded down, so the content never ends up narrower than it was drawn for.
 */
export function fillInset(actual: number, natural: number): number {
  return Math.max(0, Math.floor((actual - natural) / 2));
}

/**
 * How far each tile must shift (translateX) so the row looks like `next` while the DOM still
 * has the original order. Tiles missing from `next` (being dragged off) leave a closed gap.
 * `align` (see alignFactor): a centred or right-aligned row that gets shorter also moves its start.
 */
export function slotOffsets(original: string[], next: string[], rects: Map<string, SlotRect>, spacing: number, align = 0): Map<string, number> {
  const out = new Map<string, number>();
  const lefts = original.map((id) => rects.get(id)?.left).filter((v): v is number => v !== undefined);
  let x = lefts.length ? Math.min(...lefts) : 0;
  if (align > 0) x += align * (rowWidth(original, rects, spacing) - rowWidth(next, rects, spacing));
  for (const id of next) {
    const r = rects.get(id);
    if (!r) continue;
    out.set(id, x - r.left);
    x += r.width + spacing;
  }
  return out;
}

// ---- actions (pure helpers are exported for tests) ----------------------------------------------

export function addInstance(list: WidgetInstance[], widgetId: string, config: WidgetConfig = {}): WidgetInstance[] {
  return [...list, { instanceId: newInstanceId(widgetId), widgetId, config }];
}

export function removeInstance(list: WidgetInstance[], instanceId: string): WidgetInstance[] {
  return list.filter((i) => i.instanceId !== instanceId);
}

/** Reorders to match `order` (instance ids); unknown ids are ignored, missing ones kept at the end. */
export function reorder(list: WidgetInstance[], order: string[]): WidgetInstance[] {
  const byId = new Map(list.map((i) => [i.instanceId, i]));
  const out: WidgetInstance[] = [];
  for (const id of order) {
    const inst = byId.get(id);
    if (inst) {
      out.push(inst);
      byId.delete(id);
    }
  }
  return [...out, ...byId.values()];
}

export function patchConfig(list: WidgetInstance[], instanceId: string, patch: WidgetConfig): WidgetInstance[] {
  return list.map((i) => (i.instanceId === instanceId ? { ...i, config: { ...i.config, ...patch } } : i));
}

export const dockActions = {
  add(widgetId: string, config?: WidgetConfig) {
    useDock.setState((s) => ({ instances: addInstance(s.instances, widgetId, config) }));
  },
  remove(instanceId: string) {
    useDock.setState((s) => ({ instances: removeInstance(s.instances, instanceId) }));
  },
  /** Removes every instance of a widget (picker toggle). */
  removeWidget(widgetId: string) {
    useDock.setState((s) => ({ instances: s.instances.filter((i) => i.widgetId !== widgetId) }));
  },
  reorder(order: string[]) {
    useDock.setState((s) => ({ instances: reorder(s.instances, order) }));
  },
  setConfig(instanceId: string, patch: WidgetConfig) {
    useDock.setState((s) => ({ instances: patchConfig(s.instances, instanceId, patch) }));
  },
  update(patch: Partial<Omit<DockState, "instances">>) {
    useDock.setState(patch);
  },
};
