import { useEffect, useLayoutEffect } from "react";
import { isTauri, useTopic } from "../core/backend";
import { updateSettings, useSettings } from "../core/store";
import { useAppearancePrefs } from "../settings/keys";
import { applyAppearance } from "./apply";
import { LiveGlass } from "./glass/LiveGlass";
import { showMockDesktop } from "./glass/mockDesktop";
import { applyDemoParam } from "./devPreview";

export interface SystemTheme {
  appsLight: boolean;
  systemLight: boolean;
  accent: string | null;
  transparency: boolean;
}

interface NowPlayingAccent {
  active?: boolean;
  status?: string;
  accent?: string | null;
}

/** Windows light/dark + accent, polled by Rust only while something needs it. */
export function useSystemTheme(enabled: boolean): SystemTheme | undefined {
  return useTopic<SystemTheme>("appearance", "system", { enabled });
}

/** The accent of the cover that is playing (from the media slice), while the option is on. */
function useAlbumAccent(enabled: boolean): string | null {
  const np = useTopic<NowPlayingAccent>("media", "now_playing", { enabled });
  if (!enabled || !np?.active || !np.accent) return null;
  if (np.status !== "playing" && np.status !== "paused") return null;
  return np.accent;
}

/** Applies theme, widget style and accent to <html>, follows Windows light/dark, and mounts the live glass. */
export function AppearanceRoot() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const prefs = useAppearancePrefs();
  const system = useSystemTheme(prefs.followSystem || prefs.accentSource === "windows");
  const album = useAlbumAccent(prefs.albumArtAccent);

  useEffect(() => {
    if (!prefs.followSystem || !system) return;
    const want = system.appsLight ? prefs.lightTheme : prefs.darkTheme;
    if (want !== theme) updateSettings({ theme: want });
  }, [prefs.followSystem, prefs.lightTheme, prefs.darkTheme, system, theme]);

  let resolved = "";
  if (album) resolved = album;
  else if (prefs.accentSource === "windows") resolved = system?.accent ?? "";
  else if (prefs.accentSource === "custom") resolved = accent;

  // Browser preview: the same procedural desktop behind every theme.
  useEffect(() => {
    if (!isTauri) {
      showMockDesktop();
      applyDemoParam();
    }
  }, []);

  useLayoutEffect(() => {
    applyAppearance({ theme, widgetStyle: prefs.widgetStyle, accent: resolved });
  }, [theme, prefs.widgetStyle, resolved]);

  return <LiveGlass />;
}
