/**
 * Window growth and keyboard focus.
 *
 * The native window is just the dock strip; anything that pops out of it (card, menu, picker,
 * settings) registers its height here and the window grows away from the screen edge
 * (`shell.set_overlay`). Shrinking waits for the close animation.
 *
 * The window never takes focus on click (so the app you are in keeps it) except while a text
 * input is focused: then `shell.set_focusable(true)`.
 */
import { useEffect, type RefObject } from "react";
import { create } from "zustand";
import { call, isTauri } from "../core/backend";
import { registerHit } from "./hitRegion";
import { WINDOW_LABEL } from "../core/windowLabel";

/** Gap between the strip and a popover, and above it. */
export const POPOVER_GAP = 8;

const useOverlay = create<{ heights: Record<string, number> }>()(() => ({ heights: {} }));

let sent = 0;
let shrinkTimer: ReturnType<typeof setTimeout> | undefined;

function send(height: number) {
  sent = height;
  call("shell", "set_overlay", { label: WINDOW_LABEL, height }).catch(() => {});
}

useOverlay.subscribe((s) => {
  const want = Math.max(0, ...Object.values(s.heights));
  // A popover opened or closed: a text field that went away with it gives the keyboard back.
  scheduleFocusCheck();
  clearTimeout(shrinkTimer);
  if (want === sent) return;
  if (want > sent) send(want);
  else shrinkTimer = setTimeout(() => send(want), 180);
});

export function setOverlayHeight(id: string, height: number | null): void {
  useOverlay.setState((s) => {
    const heights = { ...s.heights };
    if (height === null || height <= 0) delete heights[id];
    else heights[id] = Math.ceil(height);
    return { heights };
  });
}

/**
 * Keeps the window tall enough for `ref` while mounted, and makes it clickable (the window
 * region only lets clicks through where something is shown; 36 px of padding keeps the
 * popover's shadow from being cut off).
 */
export function useOverlaySize(id: string, ref: RefObject<HTMLElement | null>, offset = 0): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Layout height, not the (animated, transformed) bounding box.
    const update = () => setOverlayHeight(id, (el.offsetHeight || el.getBoundingClientRect().height) + POPOVER_GAP * 2 + Math.max(0, offset));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    ro?.observe(el);
    // 36 px: panel shadows (--g-card-shadow) reach at most 26 px sideways and 36 px below, so the
    // window region never cuts one off (a cut shadow shows as a grey box over a bright window).
    const unhit = registerHit(`overlay:${id}`, el, { pad: 36 });
    return () => {
      ro?.disconnect();
      unhit();
      setOverlayHeight(id, null);
    };
  }, [id, ref, offset]);
}

/** The most a popover may grow (screen height minus the strip). */
export function maxPopoverHeight(thickness: number): number {
  const screenH = isTauri ? window.screen.height : window.innerHeight;
  return Math.max(160, screenH - thickness - POPOVER_GAP * 3);
}

// ---- focus ------------------------------------------------------------------------------------

let focusable = false;
/** Keyboard navigation (keyNav.ts) holds the focus while it runs. */
let keyboardNav = false;

export function setKeyboardNav(on: boolean): void {
  keyboardNav = on;
  setFocusable(on || isTextInput(document.activeElement));
}

export function setFocusable(value: boolean): void {
  if (value === focusable) return;
  focusable = value;
  call("shell", "set_focusable", { label: WINDOW_LABEL, focusable: value }).catch(() => {});
}

/**
 * Keeps the keyboard: a text field, or anything else inside a popover that is still open (ticking
 * a to-do after typing one must not hand the foreground back and close the card).
 */
function holdsFocus(el: Element | null): boolean {
  if (isTextInput(el)) return true;
  if (el instanceof HTMLElement && el !== document.body && el.isConnected && el.closest("[data-glintbar-panel]") !== null) return true;
  // Switching from one card to another removes the focused field but must not let go yet:
  // handing the foreground back would blur the page and close the new card.
  return interactivePopoverOpen();
}

/** Hints, labels and alerts never hold the keyboard. */
const PASSIVE_PANELS = new Set(["welcome", "tile-name", "apps-label", "alerts", "tip"]);

function interactivePopoverOpen(): boolean {
  return Array.from(document.querySelectorAll("[data-glintbar-panel]")).some((el) => !PASSIVE_PANELS.has(el.getAttribute("data-glintbar-panel") ?? ""));
}

function isTextInput(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "range", "button", "submit", "color"].includes(type);
}

let focusCheck: ReturnType<typeof setTimeout> | undefined;

/**
 * Removing a focused field (its card or panel closed, by Esc or otherwise) does not reliably
 * fire focusout, so re-check whenever a popover comes or goes. Rust then hands the foreground
 * back to the app the user was in.
 */
function scheduleFocusCheck(): void {
  clearTimeout(focusCheck);
  focusCheck = setTimeout(() => {
    if (focusable && !keyboardNav && !holdsFocus(document.activeElement)) setFocusable(false);
  }, 0);
}

/** Global listeners: take focus while a text field is focused, give it back afterwards. */
export function installFocusHandling(): void {
  document.addEventListener("focusin", (e) => {
    if (isTextInput(e.target)) setFocusable(true);
  });
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!keyboardNav && !holdsFocus(document.activeElement)) setFocusable(false);
    }, 0);
  });
}
