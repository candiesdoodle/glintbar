import { Moon, Sun, SunMoon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { call, useService } from "../../../core/backend";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ActionTile } from "../shared/ActionTile";
import type { ThemeState } from "../shared/types";

function ThemeTile({ size, isSample }: TileProps) {
  const svc = useService<ThemeState>("system", "theme_get", undefined, { refreshMs: 15_000 });
  const [light, setLight] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (svc.data) setLight(svc.data.appsLight);
  }, [svc.data]);
  const toggle = useCallback(() => {
    if (light === null || busy) return;
    const next = !light;
    setLight(next);
    setBusy(true);
    call<ThemeState>("system", "theme_set", { light: next })
      .then((t) => t && setLight(t.appsLight))
      .catch(() => setLight(!next))
      .finally(() => setBusy(false));
  }, [light, busy]);
  const isLight = light ?? false;
  return (
    <ActionTile
      size={size}
      isSample={isSample}
      icon={isLight ? Sun : Moon}
      busy={busy || light === null}
      title={light === null ? "Light / dark mode" : isLight ? "Using light mode · click to go dark" : "Using dark mode · click to go light"}
      onAction={toggle}
    />
  );
}

export default defineWidget({
  id: "system.theme-toggle",
  name: "Theme Toggle",
  category: "System",
  description: "Flips the Windows and app colour scheme from light to dark and back.",
  keywords: ["dark mode", "light mode", "theme", "appearance", "night"],
  icon: SunMoon,
  size: "s",
  Tile: ThemeTile,
});
