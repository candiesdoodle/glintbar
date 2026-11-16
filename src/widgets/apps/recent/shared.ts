import { useService } from "../../../core/backend";
import type { WidgetConfig } from "../../../core/widget";
import type { Recent } from "../types";

export interface RecentConfig extends WidgetConfig {
  tab: "files" | "apps";
}

const H = 3600_000;
const now = Date.now();

export const SAMPLE_RECENT: Recent = {
  files: [
    { name: "Quarterly report.docx", target: "C:\\Users\\you\\Documents\\Quarterly report.docx", kind: "file", at: now - 0.3 * H, icon: "sample:Quarterly report.docx" },
    { name: "holiday-photo.jpg", target: "C:\\Users\\you\\Downloads\\holiday-photo.jpg", kind: "file", at: now - 1.2 * H, icon: "sample:holiday-photo.jpg" },
    { name: "Invoice 1042.pdf", target: "C:\\Users\\you\\Downloads\\Invoice 1042.pdf", kind: "file", at: now - 3 * H, icon: "sample:Invoice 1042.pdf" },
    { name: "budget-2026.xlsx", target: "C:\\Users\\you\\Documents\\budget-2026.xlsx", kind: "file", at: now - 20 * H, icon: "sample:budget-2026.xlsx" },
  ],
  apps: ["code", "edge", "figma", "spotify", "telegram"].map((k, i) => ({
    name: { code: "Visual Studio Code", edge: "Microsoft Edge", figma: "Figma", spotify: "Spotify", telegram: "Telegram" }[k] ?? k,
    target: k,
    kind: "app" as const,
    at: now - (i * 2 + 0.2) * H,
    icon: `sample:${k}`,
  })),
};

/** Recent files and apps, refreshed every minute while visible. */
export function useRecent(isSample: boolean) {
  const r = useService<Recent>("apps", "recent", { limit: 14 }, { refreshMs: 60_000, enabled: !isSample });
  return isSample ? { ...r, data: SAMPLE_RECENT, error: undefined, loading: false } : r;
}

export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}
