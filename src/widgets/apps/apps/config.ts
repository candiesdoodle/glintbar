import { useMemo } from "react";
import type { WidgetConfig } from "../../../core/widget";
import { useAppearancePrefs, useDockPrefs, useGeneralPrefs } from "../../../settings/keys";
import type { Pin } from "../types";

export type IconSize = "small" | "medium" | "large";
export type AppStyle = "cards" | "icons";

/** What only this tile stores (its instance config). */
export interface AppsConfig extends WidgetConfig {
  /** Undefined until first seeded from the Windows taskbar's pins. */
  pins?: Pin[];
  showStart: boolean;
  /** Also show apps that are open but not pinned. */
  showRunning: boolean;
}

export const DEFAULT_APPS_CONFIG: AppsConfig = {
  showStart: true,
  showRunning: true,
};

/**
 * How apps look and behave. These are app-wide settings (Settings > Appearance and Dock), so the
 * Apps card and the Settings pages change the same values.
 */
export interface AppsLook {
  iconSize: IconSize;
  /** Apps on their own cards, or bare icons. */
  style: AppStyle;
  hoverNames: boolean;
  magnify: boolean;
  /** Largest magnified size, as a multiple (1.2 - 2). */
  magnifyScale: number;
  previews: boolean;
}

export type AppsView = AppsConfig & AppsLook;

const ICON_SIZE = { s: "small", m: "medium", l: "large" } as const;
export const PREF_ICON_SIZE = { small: "s", medium: "m", large: "l" } as const;

export function useAppsLook(): AppsLook {
  const appIconSize = useAppearancePrefs((s) => s.appIconSize);
  const appCards = useAppearancePrefs((s) => s.appCards);
  const hoverNames = useGeneralPrefs((s) => s.hoverNames);
  const magnify = useDockPrefs((s) => s.magnification);
  const magnifyScale = useDockPrefs((s) => s.magnifyScale);
  const previews = useDockPrefs((s) => s.windowPreviews);
  return useMemo(
    () => ({ iconSize: ICON_SIZE[appIconSize] ?? "medium", style: appCards ? "cards" : "icons", hoverNames, magnify, magnifyScale, previews }),
    [appIconSize, appCards, hoverNames, magnify, magnifyScale, previews],
  );
}

/** The tile's own config with the app-wide look merged in. */
export function useAppsView(config: AppsConfig): AppsView {
  const look = useAppsLook();
  return useMemo(() => ({ ...config, ...look }), [config, look]);
}

const ICON_SHARE: Record<AppStyle, Record<IconSize, number>> = {
  cards: { small: 0.5, medium: 0.62, large: 0.76 },
  icons: { small: 0.6, medium: 0.74, large: 0.88 },
};

export interface Metrics {
  /** Tile height. */
  height: number;
  /** Width of one app slot. */
  slot: number;
  icon: number;
  gap: number;
  /** Inner padding of the bare-icons frame. */
  pad: number;
}

export function metrics(height: number, cfg: Pick<AppsLook, "iconSize" | "style">, spacing: number): Metrics {
  const icon = Math.round(height * ICON_SHARE[cfg.style][cfg.iconSize]);
  if (cfg.style === "cards") return { height, slot: height, icon, gap: spacing, pad: 0 };
  return { height, slot: icon + Math.max(4, Math.round(height * 0.14)), icon, gap: 0, pad: Math.round(height * 0.1) };
}
