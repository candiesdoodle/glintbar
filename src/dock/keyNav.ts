/**
 * Keyboard control of the dock from anywhere: a global hotkey (Win+Alt+T, like the taskbar's
 * Win+T) gives the dock keyboard focus on the first app of the Apps tile (or the first tile).
 * Left/Right (and Home/End) move between apps and tiles, Enter or Space activates, Esc leaves and
 * the dock stops taking focus again. Tiles already handle arrows and Enter themselves (DockBar);
 * this adds the hotkey, the apps inside the Apps tile and leaving.
 */
import { useEffect } from "react";
import { on } from "../core/backend";
import { WINDOW_LABEL } from "../core/windowLabel";
import { setKeyboardNav } from "./overlay";
import { useDockUi } from "./ui";

export const KEYNAV_HOTKEY = { id: "dock-keys", keys: "Win+Alt+T" };
/** Tried in order when another app already owns Win+Alt+T (Xbox Game Bar uses it on many PCs). */
export const KEYNAV_FALLBACKS = ["Ctrl+Alt+Shift+T"];

let active = false;

/** The Apps tile's buttons (Start, then every app) in screen order. */
function appTargets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-glintbar-tile^="apps.apps#"] [role="button"][aria-label]'));
}

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".g-tile-key[data-glintbar-tile]"));
}

function focusEl(el: HTMLElement | undefined): void {
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: "smooth" });
}

export function startKeyboardNav(): void {
  if (!active) {
    active = true;
    document.documentElement.dataset.keynav = "1";
    setKeyboardNav(true);
  }
  focusEl(appTargets()[0] ?? tiles()[0]);
}

export function stopKeyboardNav(): void {
  if (!active) return;
  active = false;
  delete document.documentElement.dataset.keynav;
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) el.blur();
  setKeyboardNav(false);
}

function onKeyDown(e: KeyboardEvent): void {
  if (!active) return;
  const el = document.activeElement as HTMLElement | null;
  if (e.key === "Escape") {
    // A card, menu or panel closes first (Dock's own Esc handling); then the dock lets go.
    const s = useDockUi.getState();
    if (s.card || s.menu || s.panel) return;
    e.preventDefault();
    stopKeyboardNav();
    return;
  }
  const apps = appTargets();
  const i = el ? apps.indexOf(el) : -1;
  if (i < 0) return; // on a tile or inside a card: DockBar and the card handle keys
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.stopPropagation();
    el!.click();
    // Launching or switching to an app moves the focus there.
    stopKeyboardNav();
    return;
  }
  let next: HTMLElement | undefined;
  if (e.key === "ArrowRight") {
    next = apps[i + 1];
    if (!next) {
      // Past the last app: on to the tile after the Apps tile.
      const list = tiles();
      const own = el!.closest<HTMLElement>("[data-glintbar-tile]");
      next = own ? list[list.indexOf(own) + 1] : undefined;
    }
  } else if (e.key === "ArrowLeft") next = apps[i - 1];
  else if (e.key === "Home") next = apps[0];
  else if (e.key === "End") next = apps[apps.length - 1];
  else return;
  e.preventDefault();
  e.stopPropagation();
  focusEl(next ?? el!);
}

/** Mount once (Dock): listens for the hotkey (this window only) and the keys while active. */
export function useKeyboardNav(): void {
  useEffect(() => {
    const off = on<{ id?: string; label?: string; at?: number }>("shell", "hotkey", (p) => {
      if (!p || p.id !== KEYNAV_HOTKEY.id) return;
      if (p.label && p.label !== WINDOW_LABEL) return;
      if (p.at && Date.now() - p.at > 3000) return;
      startKeyboardNav();
    });
    const onBlur = () => stopKeyboardNav();
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      off();
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
