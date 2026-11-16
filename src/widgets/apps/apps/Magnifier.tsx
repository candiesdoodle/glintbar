import type { HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import type { DockApp } from "../shared/grouping";
import { AppVisual } from "./AppVisual";
import type { AppStyle, Metrics } from "./config";

export interface MagnifyItem {
  key: string;
  app?: DockApp;
  start?: boolean;
  rect: { left: number; top: number; width: number; height: number };
}

/** What a magnified icon does when pressed: exactly what its real icon does. */
export type ItemHandlers = Pick<HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onPointerEnter" | "onPointerLeave" | "onClick" | "onAuxClick" | "onContextMenu">;

/** Scale for an icon `d` slots away from the pointer (a smooth bell). */
export function magnifyScale(d: number, max: number): number {
  return 1 + (max - 1) * Math.exp(-(d * d) / 2.2);
}

/** The most the icons on one side of the pointer can be pushed outwards, in slots. The tile
 *  gets this much room on each side while magnifying, so nothing covers the next widget. */
export function magnifySpread(max: number): number {
  let sum = 0.5;
  for (let k = 1; k <= 4; k++) sum += Math.exp(-(k * k) / 2.2);
  return (max - 1) * sum;
}

/**
 * How far the largest magnified icon (plus its name) reaches beyond the top of the strip, in CSS
 * px: the room the window keeps above the dock while the pointer is on the Apps tile.
 */
export function magnifyRoom(max: number, height: number, label: boolean): number {
  return Math.ceil((max - 1) * height + (label ? 34 : 10));
}

export interface MagnifiedBox {
  key: string;
  scale: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pure layout of the magnified copies: each one's scale and its box in client px (after the
 * shift and the scale about its bottom centre, or top centre for a top dock). Exported for tests.
 */
export function magnifyLayout(items: MagnifyItem[], x: number, max: number, slotFallback: number, edge: "top" | "bottom"): MagnifiedBox[] {
  const slot = items[0]?.rect.width || slotFallback;
  const scales = items.map((it) => magnifyScale((x - (it.rect.left + it.rect.width / 2)) / slot, max));
  const extras = items.map((it, i) => (scales[i] - 1) * it.rect.width);
  // Spread from the pointer: whatever is under it stays under it (so clicks land on what you see).
  let anchor = 0;
  for (let i = 0; i < items.length; i++) {
    const r = items[i].rect;
    if (x >= r.left + r.width) anchor += extras[i];
    else {
      if (x > r.left) anchor += extras[i] * ((x - r.left) / r.width);
      break;
    }
  }
  let before = 0;
  return items.map((it, i) => {
    const shift = before + extras[i] / 2 - anchor;
    before += extras[i];
    const s = scales[i];
    const w = it.rect.width * s;
    const h = it.rect.height * s;
    const left = it.rect.left + shift + it.rect.width / 2 - w / 2;
    const top = edge === "bottom" ? it.rect.top + it.rect.height - h : it.rect.top;
    return { key: it.key, scale: s, left, top, width: w, height: h };
  });
}

/**
 * Mac-style magnification: copies of the icons drawn above the dock, scaled by distance to the
 * pointer and spread apart so they don't overlap. The copies take the pointer themselves (with
 * the same handlers as the real icons, which stay in place, invisible), so the part of an icon
 * that rises above the bar is clickable too. The Apps tile keeps room above the strip and adds
 * this area to the window's click region while the pointer is on it (see AppsTile).
 */
export function Magnifier({
  owner,
  items,
  x,
  max,
  m,
  style,
  edge,
  label,
  bind,
}: {
  /** The Apps tile's instance id (the layer is found by it). */
  owner: string;
  items: MagnifyItem[];
  x: number;
  max: number;
  m: Metrics;
  style: AppStyle;
  edge: "top" | "bottom";
  label: boolean;
  bind: (key: string) => ItemHandlers;
}) {
  const boxes = magnifyLayout(items, x, max, m.slot, edge);
  const top = boxes.reduce((best, b, i) => (b.scale > boxes[best].scale ? i : best), 0);
  return createPortal(
    // Below popovers (z-30): menus and previews stay on top of the enlarged icons.
    <div data-glintbar-magnify={owner} className="pointer-events-none fixed inset-0 z-[25]" style={{ ["--g-radius-tile" as string]: `${Math.round(m.height * 0.27)}px` }}>
      {items.map((it, i) => {
        const b = boxes[i];
        const s = b.scale;
        const shift = b.left + b.width / 2 - (it.rect.left + it.rect.width / 2);
        const name = it.start ? "Start" : it.app?.name;
        return (
          <div
            key={it.key}
            data-mag-key={it.key}
            data-app-key={it.app ? it.key : undefined}
            className="pointer-events-auto fixed"
            style={{
              left: it.rect.left,
              top: it.rect.top,
              width: it.rect.width,
              height: it.rect.height,
              transform: `translateX(${shift}px) scale(${s})`,
              transformOrigin: edge === "bottom" ? "50% 100%" : "50% 0%",
              transition: "transform 80ms ease-out",
              zIndex: Math.round(s * 10),
            }}
            {...bind(it.key)}
          >
            <AppVisual app={it.app} start={it.start} m={m} style={style} />
            {label && i === top && s > 1.15 && name && (
              <div
                className="g-panel pointer-events-none absolute left-1/2 px-2 py-0.5 text-[11px] whitespace-nowrap text-fg"
                style={{
                  transform: `translateX(-50%) scale(${1 / s})`,
                  transformOrigin: edge === "bottom" ? "50% 100%" : "50% 0%",
                  [edge === "bottom" ? "bottom" : "top"]: "calc(100% + 6px)",
                  borderRadius: 8,
                }}
              >
                {name}
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
