/**
 * Visibility plumbing so off-screen tiles stop refreshing.
 *
 * The dock wraps every tile in `<VisibleProvider value={...}>`; `useService`, `useTopic`,
 * `useNow` and `useInterval` read it through `useIsVisible()` and pause when false.
 */
import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const VisibleContext = createContext(true);

export function VisibleProvider({ value, children }: { value: boolean; children: ReactNode }) {
  const parent = useContext(VisibleContext);
  return createElement(VisibleContext.Provider, { value: parent && value }, children);
}

/** False while the surrounding tile is scrolled out, the dock is hidden or the page is hidden. */
export function useIsVisible(): boolean {
  const ctx = useContext(VisibleContext);
  const pageVisible = usePageVisible();
  return ctx && pageVisible;
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * True while `ref` intersects `root` (default: viewport). Used by the dock and the picker.
 */
export function useInView<T extends Element>(root?: RefObject<Element | null>, margin = "0px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), {
      root: root?.current ?? null,
      rootMargin: margin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root, margin]);
  return [ref, inView];
}

/** setInterval that pauses while not visible. */
export function useInterval(cb: () => void, ms: number | null): void {
  const visible = useIsVisible();
  const saved = useRef(cb);
  saved.current = cb;
  useEffect(() => {
    if (!visible || ms === null) return;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [visible, ms]);
}

/**
 * The current time, re-rendering on whole-second (`"second"`) or whole-minute (`"minute"`)
 * boundaries while visible. Catches up immediately when the tile becomes visible again.
 */
export function useNow(granularity: "second" | "minute" = "second"): Date {
  const visible = useIsVisible();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!visible) return;
    const step = granularity === "second" ? 1000 : 60_000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, step - (d.getTime() % step) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [visible, granularity]);
  return now;
}
