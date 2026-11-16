/**
 * One IntersectionObserver per scroll container for all picker cards (cheaper than one each).
 * Returns [ref, inView, seenOnce]: previews mount the first time a card comes near the viewport
 * and pause (inView = false) while it is scrolled away.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

type Callback = (visible: boolean) => void;
const observers = new WeakMap<Element, { io: IntersectionObserver; cbs: Map<Element, Callback> }>();

function observerFor(root: Element) {
  let entry = observers.get(root);
  if (!entry) {
    const cbs = new Map<Element, Callback>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) cbs.get(e.target)?.(e.isIntersecting);
      },
      { root, rootMargin: "120px 0px" },
    );
    entry = { io, cbs };
    observers.set(root, entry);
  }
  return entry;
}

export function useLazyVisible<T extends Element>(root: RefObject<Element | null>): [RefObject<T | null>, boolean, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const r = root.current;
    if (!el || !r || typeof IntersectionObserver === "undefined") {
      setInView(true);
      setSeen(true);
      return;
    }
    const { io, cbs } = observerFor(r);
    cbs.set(el, (v) => {
      setInView(v);
      if (v) setSeen(true);
    });
    io.observe(el);
    return () => {
      io.unobserve(el);
      cbs.delete(el);
    };
  }, [root]);
  return [ref, inView, seen];
}
