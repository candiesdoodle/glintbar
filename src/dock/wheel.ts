/**
 * Smooth sideways scrolling for the dock: a mouse wheel notch glides (eased, frame by frame,
 * only while moving); a touchpad scrolls 1:1 and only once (the default is prevented so the
 * browser doesn't scroll it a second time).
 */
import { useEffect, type RefObject } from "react";

/** Touchpads send small pixel deltas (often with a sideways part); wheels send big notches. */
export function isPreciseWheel(e: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">): boolean {
  return e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 50);
}

/** One wheel event in px along the dock. */
export function wheelDelta(e: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">, pageWidth: number): number {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (e.deltaMode === 1) return d * 40;
  if (e.deltaMode === 2) return d * pageWidth;
  return d;
}

export function useSmoothWheel(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let target = el.scrollLeft;
    // Our own float position: scrollLeft may round, which would stall the easing.
    let pos = el.scrollLeft;
    let raf = 0;
    const step = () => {
      const diff = target - pos;
      if (Math.abs(diff) < 0.5) {
        el.scrollLeft = target;
        pos = target;
        raf = 0;
        return;
      }
      pos += diff * 0.22;
      el.scrollLeft = pos;
      raf = requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      e.preventDefault();
      const delta = wheelDelta(e, el.clientWidth);
      if (isPreciseWheel(e)) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta));
        target = el.scrollLeft;
        return;
      }
      if (!raf) pos = el.scrollLeft;
      const from = raf ? target : el.scrollLeft;
      target = Math.max(0, Math.min(max, from + delta));
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}
