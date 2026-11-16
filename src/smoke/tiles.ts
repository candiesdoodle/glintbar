/**
 * Render status of every tile on the dock (smoke mode): did its code load, did the error boundary
 * catch it, is it showing sample data, what does it say. Appended per batch to smoke/tiles.json.
 */
import { isConnected, needsConnection } from "../core/connections";
import { getWidget, isKnownWidget, widgetIds } from "../core/registry";
import { SIZE_UNITS, tileWidth } from "../core/widget";
import { useDock } from "../dock/layout";
import { consoleEntries } from "./console";
import { writeSmokeJson } from "./io";

export interface TileStatus {
  batch: string;
  widgetId: string;
  instanceId: string;
  known: boolean;
  loaded: boolean;
  rendered: boolean;
  /** The error boundary caught a render error (the tile shows "!"). */
  crashed: boolean;
  crashMessage: string | null;
  /** Account widget that is not connected: shows sample numbers (expected on CI). */
  sample: boolean;
  sampleBadge: boolean;
  /** Tile is inside the visible part of the bar (only visible tiles fetch data). */
  onScreen: boolean;
  empty: boolean;
  text: string;
  errorsSinceBatch: string[];
}

const all: TileStatus[] = [];

function visibleIn(el: HTMLElement, bar: HTMLElement | null): boolean {
  if (!bar) return false;
  const r = el.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  return r.width > 0 && r.left >= b.left - 1 && r.right <= b.right + 1;
}

export function inspectTiles(batch: string, sinceMs: number): TileStatus[] {
  const bar = document.querySelector<HTMLElement>("[data-glintbar-bar]");
  const errors = consoleEntries.filter((e) => e.at >= sinceMs && e.level !== "warn");
  const out: TileStatus[] = [];
  for (const inst of useDock.getState().instances) {
    const el = document.querySelector<HTMLElement>('[data-glintbar-tile="' + CSS.escape(inst.instanceId) + '"]');
    const def = getWidget(inst.widgetId);
    const crashLog = errors.find((e) => e.text.includes("[" + inst.widgetId + "] crashed"));
    const text = (el?.innerText ?? "").replace(/\s+/g, " ").trim();
    const hasGraphics = Boolean(el?.querySelector("svg, img, canvas"));
    out.push({
      batch,
      widgetId: inst.widgetId,
      instanceId: inst.instanceId,
      known: isKnownWidget(inst.widgetId),
      loaded: Boolean(def),
      rendered: Boolean(el && def && el.childElementCount > 0),
      crashed: Boolean(el?.querySelector('[title$=" stopped working"]')) || Boolean(crashLog),
      crashMessage: crashLog ? crashLog.text.slice(0, 600) : null,
      sample: def ? needsConnection(def) && !isConnected(def.id) : false,
      sampleBadge: Boolean(el?.querySelector('[title="Sample data"], [aria-label="Sample data"]')),
      onScreen: el ? visibleIn(el, bar) : false,
      empty: !text && !hasGraphics,
      text: text.slice(0, 120),
      errorsSinceBatch: errors.filter((e) => e.text.includes(inst.widgetId)).map((e) => e.text.slice(0, 300)).slice(0, 5),
    });
  }
  return out;
}

export async function recordTiles(batch: string, sinceMs: number) {
  const list = inspectTiles(batch, sinceMs);
  all.push(...list);
  const batchErrors = consoleEntries.filter((e) => e.at >= sinceMs && e.level !== "warn").map((e) => e.text.slice(0, 300));
  await writeSmokeJson("tiles.json", {
    widgets: widgetIds.length,
    covered: new Set(all.filter((t) => t.rendered).map((t) => t.widgetId)).size,
    crashed: [...new Set(all.filter((t) => t.crashed).map((t) => t.widgetId))],
    notRendered: [...new Set(all.filter((t) => !t.rendered).map((t) => t.widgetId))],
    tiles: all,
  }).catch(() => {});
  return {
    batch,
    tiles: list.length,
    crashed: list.filter((t) => t.crashed).map((t) => t.widgetId),
    notRendered: list.filter((t) => !t.rendered).map((t) => t.widgetId),
    offScreen: list.filter((t) => !t.onScreen).map((t) => t.widgetId),
    errors: batchErrors.slice(0, 10),
  };
}

/**
 * Splits every widget into dock-sized batches: as many tiles as fit in `maxWidth` CSS px at the
 * current tile size. Content-sized tiles (fit: "content") count as 8 units.
 */
export function planBatches(maxWidth: number): string[][] {
  const d = useDock.getState();
  const batches: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  for (const id of [...widgetIds].sort()) {
    const def = getWidget(id);
    const w = def ? (def.fit === "content" ? 8 * d.sizePx : tileWidth(def.size, d.sizePx, d.spacing)) : SIZE_UNITS.m * d.sizePx;
    if (cur.length && used + w + d.spacing > maxWidth) {
      batches.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(id);
    used += w + d.spacing;
  }
  if (cur.length) batches.push(cur);
  return batches;
}
