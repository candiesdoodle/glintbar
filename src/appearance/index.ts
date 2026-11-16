/**
 * Appearance: themes (src/styles/themes.css), accent, Clear widget styles, light/dark following
 * and the live glass. Mount `<AppearanceRoot />` once, before the dock.
 */
import "../styles/themes.css";

export { AppearanceRoot, useSystemTheme, type SystemTheme } from "./AppearanceRoot";
export { applyAppearance, setAccent } from "./apply";
export { ACCENTS, THEMES, glassLook, isLightTheme, themeMeta, type GlassLook, type ThemeMeta } from "./themes";
export { textOn, parseHex, fitAccent } from "./color";
export { ThemePreview } from "./ThemePreview";
