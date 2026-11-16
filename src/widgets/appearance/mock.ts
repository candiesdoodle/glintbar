/** Browser sample data for the appearance service (src-tauri/src/services/appearance). */
import { mockService, mockTopic } from "../../core/mock";

const systemTheme = () => ({
  appsLight: typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches,
  systemLight: false,
  accent: "#0078d4",
  transparency: true,
});

mockService("appearance", {
  // The browser preview draws the glass from a procedural desktop (src/appearance/glass/sources.ts).
  glass_attach: () => undefined,
  glass_config: () => undefined,
  glass_ack: () => undefined,
  glass_state: () => ({ tier: "capture", reason: null, resting: true }),
  system_theme: systemTheme,
  wallpaper_info: () => ({ path: "C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg", placement: "fill", background: "#000000" }),
  export_settings: () => ({ path: "C:\\Users\\you\\Downloads\\GlintBar settings.json", folder: "C:\\Users\\you\\Downloads" }),
});

mockTopic("appearance", "system", { every: 3000, sample: systemTheme });
