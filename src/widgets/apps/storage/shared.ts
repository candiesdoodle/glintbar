import { useEffect, useMemo } from "react";
import { useService } from "../../../core/backend";
import { useStored } from "../../../core/store";
import type { WidgetConfig } from "../../../core/widget";
import { daysUntilFull, HISTORY_KEY, recordDrives, type History } from "../shared/forecast";
import type { Drive } from "../types";

export interface StorageConfig extends WidgetConfig {
  /** "C:\\" etc.; empty = the Windows drive. */
  root: string;
}

const GB = 1024 ** 3;

export const SAMPLE_DRIVES: Drive[] = [
  { root: "C:\\", letter: "C", label: "Windows", fs: "NTFS", kind: "fixed", total: 476 * GB, free: Math.round(118.4 * GB), system: true },
  { root: "D:\\", letter: "D", label: "Data", fs: "NTFS", kind: "fixed", total: 931 * GB, free: 612 * GB, system: false },
];

export function useDrives(isSample: boolean) {
  const r = useService<Drive[]>("apps", "drives", undefined, { refreshMs: 60_000, enabled: !isSample });
  const [history] = useStored<History>(HISTORY_KEY, {});
  useEffect(() => {
    if (!isSample && r.data?.length) recordDrives(r.data);
  }, [isSample, r.data]);
  const drives = isSample ? SAMPLE_DRIVES : r.data;
  return { ...r, drives, history };
}

export function pickDrive(drives: Drive[] | undefined, root: string): Drive | undefined {
  if (!drives?.length) return undefined;
  return drives.find((d) => d.root.toLowerCase() === root.toLowerCase()) ?? drives.find((d) => d.system) ?? drives[0];
}

export function useForecast(drive: Drive | undefined, history: History, isSample: boolean): number | null {
  return useMemo(() => {
    if (isSample) return 74;
    if (!drive) return null;
    return daysUntilFull(history[drive.root] ?? [], drive.free);
  }, [drive, history, isSample]);
}

export function usedShare(d: Drive): number {
  return d.total > 0 ? (d.total - d.free) / d.total : 0;
}

/** Accent until 80 % used, warning to 92 %, then bad. */
export function usageColor(share: number): string {
  if (share >= 0.92) return "var(--g-bad)";
  if (share >= 0.8) return "var(--g-warn)";
  return "var(--g-accent)";
}

export function fullIn(days: number | null): string | null {
  if (days === null) return null;
  if (days <= 1) return "Full in a day";
  if (days > 365) return null;
  return `Full in ${days} days`;
}
