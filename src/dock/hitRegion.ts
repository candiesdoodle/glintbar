/**
 * Input passthrough. The native dock window is larger than what it shows (it keeps room above
 * the strip for cards and menus), so Rust clips it to a window region built from the rects
 * reported here: the bar and every open popover. Everything else - the transparent parts -
 * lets clicks go to the windows underneath.
 *
 * Rects are in CSS px measured from the dock's screen edge (`near`/`far`), so they stay right
 * while the window grows away from that edge. Elements register with `useHitRect`.
 */
import { useEffect, type RefObject } from "react";
import { call } from "../core/backend";
import { stripThickness, useDock } from "./layout";
import { WINDOW_LABEL } from "../core/windowLabel";

export interface HitRect {
  left: number;
  width: number;
  near: number;
  far: number;
}

interface Entry {
  el: HTMLElement;
  /** Extra px around the element (shadows). */
  pad: number;
  /** "bar": spans the whole strip height from the screen edge. */
  kind: "bar" | "panel";
  /** Extra px away from the screen edge (room for content drawn above the element, e.g. magnified apps). */
  grow: number;
}

const entries = new Map<string, Entry>();
const observers = new Map<string, ResizeObserver>();
let full = false;
let queued = false;
let lastSent = "";

/** Pure: one element's rect -> edge-relative hit rect. Exported for tests. */
export function toHitRect(
  r: { left: number; top: number; width: number; height: number },
  kind: "bar" | "panel",
  pad: number,
  edge: "top" | "bottom",
  viewportHeight: number,
  thickness: number,
): HitRect {
  const left = Math.floor(r.left - pad);
  const width = Math.ceil(r.width + pad * 2);
  if (kind === "bar") return { left, width, near: 0, far: thickness };
  const nearRaw = edge === "bottom" ? viewportHeight - (r.top + r.height) : r.top;
  const farRaw = edge === "bottom" ? viewportHeight - r.top : r.top + r.height;
  return { left, width, near: Math.max(0, Math.floor(nearRaw - pad)), far: Math.ceil(farRaw + pad) };
}

/** Pure: `r` extended by `grow` px away from the dock's screen edge. Exported for tests. */
export function grownRect(r: { left: number; top: number; width: number; height: number }, grow: number, edge: "top" | "bottom") {
  const g = Math.max(0, grow);
  return edge === "bottom" ? { left: r.left, top: r.top - g, width: r.width, height: r.height + g } : { left: r.left, top: r.top, width: r.width, height: r.height + g };
}

function compute(): HitRect[] {
  const d = useDock.getState();
  const thickness = stripThickness(d);
  const vh = window.innerHeight;
  const out: HitRect[] = [];
  for (const e of entries.values()) {
    if (!e.el.isConnected) continue;
    const r = e.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const box = e.grow > 0 ? grownRect(r, e.grow, d.edge) : r;
    out.push(toHitRect(box, e.kind, e.pad, d.edge, vh, thickness));
  }
  return out;
}

function flush() {
  queued = false;
  const rects = compute();
  const key = JSON.stringify([full, rects]);
  if (key === lastSent) return;
  lastSent = key;
  call("shell", "set_hit_rects", { label: WINDOW_LABEL, rects, full }).catch(() => {});
}

const nextFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16);

/** Coalesces every change in one frame into one call. */
export function refreshHits(): void {
  if (queued) return;
  queued = true;
  nextFrame(flush);
}

/** While true the whole window takes the pointer (dragging a tile off the dock). */
export function setHitFull(value: boolean): void {
  if (full === value) return;
  full = value;
  refreshHits();
}

export function registerHit(id: string, el: HTMLElement, opts: { pad?: number; kind?: "bar" | "panel"; grow?: number } = {}): () => void {
  entries.set(id, { el, pad: opts.pad ?? 0, kind: opts.kind ?? "panel", grow: opts.grow ?? 0 });
  observers.get(id)?.disconnect();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(refreshHits);
    ro.observe(el);
    observers.set(id, ro);
  }
  refreshHits();
  return () => {
    if (entries.get(id)?.el !== el) return;
    entries.delete(id);
    observers.get(id)?.disconnect();
    observers.delete(id);
    refreshHits();
  };
}

/** Registers `ref` as a clickable area while mounted. */
export function useHitRect(id: string, ref: RefObject<HTMLElement | null>, opts: { pad?: number; kind?: "bar" | "panel" } = {}): void {
  const { pad, kind } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerHit(id, el, { pad, kind });
  }, [id, ref, pad, kind]);
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", refreshHits);
  // Popovers slide in: measure again once their animation has settled.
  document.addEventListener("animationend", refreshHits, true);
  document.addEventListener("transitionend", (e) => {
    if ((e.target as HTMLElement | null)?.closest?.("[data-glintbar-panel], [data-glintbar-bar]")) refreshHits();
  }, true);
  useDock.subscribe(refreshHits);
}
