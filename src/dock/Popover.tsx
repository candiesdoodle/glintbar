import { useEffect, useRef, useState, type ReactNode } from "react";
import { clamp, cx } from "../ui/cx";
import { useStripThickness } from "./fit";
import { useDock } from "./layout";
import { maxPopoverHeight, POPOVER_GAP, useOverlaySize } from "./overlay";
import type { Anchor } from "./ui";

const MARGIN = 8;

function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * A panel that comes out of the dock: above it for a bottom dock, below it for a top dock,
 * horizontally centred on `anchor` (or starting at it with `align="start"`), clamped to the
 * screen. Grows the native window while mounted.
 */
export function Popover({
  id,
  anchor,
  align = "center",
  width,
  maxHeight,
  className,
  instanceId,
  offset = 0,
  children,
}: {
  id: string;
  /** The widget instance a card belongs to (right-click inside it offers Remove). */
  instanceId?: string;
  anchor: Anchor | "center";
  align?: "center" | "start";
  width: number;
  maxHeight?: number;
  className?: string;
  /** Extra distance from the bar (the Apps tile keeps its popovers above magnified icons). */
  offset?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const edge = useDock((s) => s.edge);
  // The strip as drawn (smaller on a short screen); the popover itself keeps its size.
  const thickness = useStripThickness();
  const vw = useViewportWidth();
  // Grows the window and makes the popover clickable (see overlay.ts / hitRegion.ts).
  useOverlaySize(id, ref, offset);

  const w = Math.min(width, vw - MARGIN * 2);
  let left: number;
  if (anchor === "center") left = (vw - w) / 2;
  else if (align === "start") left = anchor.left;
  else left = anchor.left + anchor.width / 2 - w / 2;
  left = clamp(left, MARGIN, vw - w - MARGIN);
  const maxH = Math.min(maxHeight ?? Infinity, maxPopoverHeight(thickness + offset));

  return (
    <div
      ref={ref}
      data-glintbar-panel={id}
      data-glintbar-instance={instanceId}
      className={cx("g-panel pointer-events-auto fixed z-30 flex flex-col overflow-hidden text-fg", edge === "bottom" ? "g-pop-up" : "g-pop-down", className)}
      style={{ left, width: w, maxHeight: maxH, [edge === "bottom" ? "bottom" : "top"]: thickness + POPOVER_GAP + offset }}
    >
      {children}
    </div>
  );
}
