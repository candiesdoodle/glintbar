/**
 * Settings keys added by the appearance/settings slice. Every new preference lives here, in three
 * persisted stores (one store key each). The foundation's keys stay where they are:
 *   - "settings" (src/core/store.ts): theme, accent, clock24h, showSeconds
 *   - "dock"     (src/dock/layout.ts): edge, size, spacing, padding, distance, fullWidth, autoHide,
 *                 hideTaskbar, reserveSpace, instances
 *
 * Who reads what (each preference has exactly one home; nothing keeps a private copy):
 *   - "settings.general"    units/temperature (weather, network), hoverNames (dock tiles and the
 *                           Apps tile)
 *   - "settings.appearance" src/appearance (theme, glass) and the Apps tile (appIconSize, appCards)
 *   - "settings.dock"       src/dock/shell.ts -> shell.set_dock (displays, taskbar mode, show on
 *                           desktop), lockDock (dock + menu), fullWidthAlign (src/dock/DockBar.tsx,
 *                           every dock window), and the Apps tile (magnification, magnifyScale,
 *                           windowPreviews). Settings > Dock writes "dock" and these.
 * Rust never reads these keys: it gets what it needs through shell.set_dock ("shell.geometry").
 */
import { createPersistedStore, type ThemeId } from "../core/store";

export type Units = "metric" | "imperial";
export type TemperatureUnit = "c" | "f";
/** Clear theme only: what each widget looks like when there is no bar. */
export type WidgetStyle = "black" | "white" | "frosted";
export type IconSize = "s" | "m" | "l";
export type Displays = "main" | "all" | "follow";
/** Where the widgets sit on a full-width dock. */
export type DockAlign = "left" | "center" | "right";
/** "hidden" = hide while GlintBar runs, "autohide" = switch Windows' own auto-hide on, "leave" = don't touch it. */
export type TaskbarMode = "hidden" | "autohide" | "leave";
/** Where the accent colour comes from. "custom" uses settings.accent. */
export type AccentSource = "theme" | "custom" | "windows";
export type GlassSource = "auto" | "wallpaper";

export interface GeneralPrefs {
  units: Units;
  temperature: TemperatureUnit;
  /** Names above dock icons and widgets on hover. */
  hoverNames: boolean;
}

export interface AppearancePrefs {
  accentSource: AccentSource;
  /** Tint the accent with the cover of what is playing (media/now_playing accent). */
  albumArtAccent: boolean;
  widgetStyle: WidgetStyle;
  appIconSize: IconSize;
  /** Apps on their own cards (tiles) or just their icons. */
  appCards: boolean;
  /**
   * Live refraction for the glass styles: the screen behind the dock, which leaves the dock out
   * of screenshots and recordings. Off (the default): the glass shows the desktop picture.
   */
  liveGlass: boolean;
  glassFps: 30 | 60;
  glassSource: GlassSource;
  /** Switch between two themes with Windows' light/dark mode. */
  followSystem: boolean;
  lightTheme: ThemeId;
  darkTheme: ThemeId;
}

export interface DockPrefs {
  /** With auto-hide: stay up while the desktop is showing (no window in front). */
  showOnDesktop: boolean;
  displays: Displays;
  /** Widgets move only while the Widgets picker is open, and the dock can't be dragged. */
  lockDock: boolean;
  taskbarMode: TaskbarMode;
  /** Mac-style magnification of app icons on hover. */
  magnification: boolean;
  /** Magnified size as a multiple of the icon (1.2 - 2). */
  magnifyScale: number;
  /** Resting on an open app shows its windows. */
  windowPreviews: boolean;
  /** Full width only: widgets at the left, centre or right (left when they overflow). */
  fullWidthAlign: DockAlign;
}

export const DEFAULT_GENERAL: GeneralPrefs = {
  units: typeof navigator !== "undefined" && /^en-(US|LR|MM)$/i.test(navigator.language) ? "imperial" : "metric",
  temperature: typeof navigator !== "undefined" && /^en-(US|LR|MM)$/i.test(navigator.language) ? "f" : "c",
  hoverNames: true,
};

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  accentSource: "theme",
  albumArtAccent: false,
  widgetStyle: "frosted",
  appIconSize: "m",
  appCards: true,
  liveGlass: false,
  glassFps: 30,
  glassSource: "auto",
  followSystem: false,
  lightTheme: "ios-glass",
  darkTheme: "midnight",
};

export const DEFAULT_DOCK_PREFS: DockPrefs = {
  showOnDesktop: false,
  displays: "main",
  lockDock: false,
  taskbarMode: "hidden",
  magnification: false,
  magnifyScale: 1.5,
  windowPreviews: true,
  fullWidthAlign: "left",
};

export const KEYS = {
  general: "settings.general",
  appearance: "settings.appearance",
  dock: "settings.dock",
} as const;

export const useGeneralPrefs = createPersistedStore<GeneralPrefs>(KEYS.general, DEFAULT_GENERAL);
export const useAppearancePrefs = createPersistedStore<AppearancePrefs>(KEYS.appearance, DEFAULT_APPEARANCE);
export const useDockPrefs = createPersistedStore<DockPrefs>(KEYS.dock, DEFAULT_DOCK_PREFS);

export const updateGeneral = (patch: Partial<GeneralPrefs>) => useGeneralPrefs.setState(patch);
export const updateAppearance = (patch: Partial<AppearancePrefs>) => useAppearancePrefs.setState(patch);
export const updateDockPrefs = (patch: Partial<DockPrefs>) => useDockPrefs.setState(patch);
