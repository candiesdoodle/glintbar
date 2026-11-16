import { useEffect, useRef } from "react";
import { useSettings } from "../../core/store";
import { usePageVisible } from "../../core/useVisible";
import { isMainWindow } from "../../core/windowLabel";
import { useDockUi } from "../../dock/ui";
import { useAppearancePrefs } from "../../settings/keys";
import { setGlassTone, setLiveGlass } from "../apply";
import { glassLook, type GlassLook } from "../themes";
import { GlassEngine } from "./engine";

/**
 * The glass under the dock bar, for the glass themes (and Clear with frosted widgets).
 * Mounted before the dock so the canvas sits under the bar. Stops capturing while the dock is
 * hidden or the page is hidden.
 *
 * "Live glass" on: the screen behind the dock (Rust then leaves the dock out of screen captures).
 * Off: the desktop picture only, so the dock stays visible in screenshots and recordings.
 * Extra dock windows (Displays = All) show plain translucency: Rust feeds the main window only.
 */
export function LiveGlass() {
  const theme = useSettings((s) => s.theme);
  const widgetStyle = useAppearancePrefs((s) => s.widgetStyle);
  const live = useAppearancePrefs((s) => s.liveGlass);
  const fps = useAppearancePrefs((s) => s.glassFps);
  const source = useAppearancePrefs((s) => s.glassSource);
  const hidden = useDockUi((s) => s.hidden);
  const pageVisible = usePageVisible();
  const look = glassLook(theme, widgetStyle);
  const toneAware = theme === "glass" || (theme === "clear" && widgetStyle === "frosted");

  useEffect(() => {
    if (!look) {
      setLiveGlass("off");
      setGlassTone(null);
    } else if (!isMainWindow) {
      setLiveGlass("fallback");
      setGlassTone(null);
    }
  }, [look]);

  if (!look || !isMainWindow) return null;
  return <GlassLayer look={look} toneAware={toneAware} fps={fps} source={live ? source : "wallpaper"} active={!hidden && pageVisible} />;
}

function GlassLayer({ look, toneAware, fps, source, active }: { look: GlassLook; toneAware: boolean; fps: 30 | 60; source: "auto" | "wallpaper"; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GlassEngine | null>(null);
  const initial = useRef({ look, fps, source });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const e = new GlassEngine(canvas, initial.current.look, { fps: initial.current.fps, source: initial.current.source });
    engine.current = e;
    return () => {
      engine.current = null;
      e.dispose();
    };
  }, []);

  useEffect(() => engine.current?.setLook(look, toneAware), [look, toneAware]);
  useEffect(() => engine.current?.setOptions({ fps, source }), [fps, source]);
  useEffect(() => engine.current?.setActive(active), [active]);

  return <canvas ref={ref} className="g-glass-canvas" aria-hidden style={{ display: "none" }} />;
}
