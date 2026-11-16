/** The six themes: names for the gallery, light/dark, and the live-glass look of each. */
import type { ThemeId } from "../core/store";

/** How the WebGL glass bends and frosts what is behind the dock (CSS px unless noted). */
export interface GlassLook {
  /** Draw the bar's own glass (false for Clear: only the widgets are glass). */
  bar: boolean;
  /** How far the edge refraction reaches outward. */
  bend: number;
  /** Width of the curved rim zone where the bending happens. */
  bevel: number;
  /** Frost blur radius. */
  frost: number;
  /** Chromatic dispersion at the rim, 0-1. */
  dispersion: number;
  /** Specular rim highlight, 0-1. */
  rim: number;
  saturation: number;
  brightness: number;
  /** Glass widgets inside the bar: their own smaller lens and rim. */
  tileBend: number;
  tileRim: number;
  /** Frost inside glass widgets (more than the bar, so their text stays readable). */
  tileFrost: number;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  blurb: string;
  light: boolean;
  /** null = no live glass (solid themes). */
  glass: GlassLook | null;
}

const LIQUID: GlassLook = { bar: true, bend: 15, bevel: 20, frost: 2.2, dispersion: 0.45, rim: 0.95, saturation: 1.18, brightness: 1.05, tileBend: 5, tileRim: 0.55, tileFrost: 7 };
const IOS: GlassLook = { bar: true, bend: 8, bevel: 15, frost: 10, dispersion: 0.18, rim: 0.75, saturation: 1.7, brightness: 1.08, tileBend: 3, tileRim: 0.5, tileFrost: 14 };
const MIDNIGHT: GlassLook = { bar: true, bend: 11, bevel: 18, frost: 5, dispersion: 0.25, rim: 0.5, saturation: 1.25, brightness: 0.92, tileBend: 3, tileRim: 0.3, tileFrost: 9 };
const CLEAR_FROSTED: GlassLook = { bar: false, bend: 0, bevel: 0, frost: 7, dispersion: 0.3, rim: 0, saturation: 1.35, brightness: 1.02, tileBend: 7, tileRim: 0.85, tileFrost: 9 };

export const THEMES: ThemeMeta[] = [
  { id: "glass", name: "Glass", blurb: "See-through glass with refracted edges.", light: false, glass: LIQUID },
  { id: "ios-glass", name: "Frosted Glass", blurb: "Bright frosted glass with a soft blur.", light: true, glass: IOS },
  { id: "midnight", name: "Midnight", blurb: "Glass with a dark tint.", light: false, glass: MIDNIGHT },
  { id: "black", name: "Black", blurb: "Opaque dark bar, no glass.", light: false, glass: null },
  { id: "white", name: "White", blurb: "Opaque light bar, no glass.", light: true, glass: null },
  { id: "clear", name: "Clear", blurb: "Widgets float with no bar behind them.", light: false, glass: null },
];

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[2];
}

/** The glass look for a theme + Clear widget style, or null when nothing is glass. */
export function glassLook(id: ThemeId, widgetStyle: string): GlassLook | null {
  if (id === "clear") return widgetStyle === "frosted" ? CLEAR_FROSTED : null;
  return themeMeta(id).glass;
}

/** Is the theme light (dark text) as a whole? Clear follows its widget style. */
export function isLightTheme(id: ThemeId, widgetStyle: string): boolean {
  if (id === "clear") return widgetStyle === "white";
  return themeMeta(id).light;
}

export const ACCENTS: Array<{ name: string; value: string }> = [
  { name: "Blue", value: "#0a84ff" },
  { name: "Indigo", value: "#5e5ce6" },
  { name: "Purple", value: "#bf5af2" },
  { name: "Pink", value: "#ff375f" },
  { name: "Red", value: "#ff453a" },
  { name: "Orange", value: "#ff9f0a" },
  { name: "Yellow", value: "#ffd60a" },
  { name: "Green", value: "#30d158" },
  { name: "Mint", value: "#63e6be" },
  { name: "Teal", value: "#40c8e0" },
  { name: "Graphite", value: "#8e8e93" },
];
