/**
 * Writes the appearance onto an element (normally <html>): theme, Clear widget style, accent.
 * Everything else is CSS (src/styles/themes.css).
 */
import type { ThemeId } from "../core/store";
import { fitAccent, textOn } from "./color";
import { isLightTheme } from "./themes";

export interface AppliedAppearance {
  theme: ThemeId;
  widgetStyle: string;
  /** Resolved accent colour, or "" for the theme's own. */
  accent: string;
}

export function applyAppearance(a: AppliedAppearance, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = a.theme;
  el.dataset.widgetStyle = a.widgetStyle;
  setAccent(el, a.accent, isLightTheme(a.theme, a.widgetStyle));
}

export function setAccent(el: HTMLElement, accent: string, lightTheme: boolean): void {
  if (accent) {
    const fitted = fitAccent(accent, lightTheme);
    el.style.setProperty("--g-accent", fitted);
    el.style.setProperty("--g-on-accent", textOn(fitted));
  } else {
    el.style.removeProperty("--g-accent");
    el.style.removeProperty("--g-on-accent");
  }
}

/** "on" = the WebGL glass is drawing; "fallback" = glass theme without frames; "off" = solid theme. */
export function setLiveGlass(state: "on" | "off" | "fallback"): void {
  document.documentElement.dataset.liveGlass = state;
}

let tone: "dark" | "light" | undefined;
/** What is behind clear glass: bright (dark text) or dark (white text), with hysteresis. */
export function setGlassTone(luma: number | null): void {
  const root = document.documentElement;
  if (luma === null) {
    tone = undefined;
    delete root.dataset.glassTone;
    return;
  }
  const next = tone === "light" ? (luma < 0.5 ? "dark" : "light") : luma > 0.64 ? "light" : "dark";
  if (next !== tone) {
    tone = next;
    root.dataset.glassTone = next;
  }
}
