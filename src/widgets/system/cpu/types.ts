/** Mirrors src-tauri/src/services/system/cpu.rs (serde camelCase). */
export interface CpuSample {
  /** 0-100 */
  usage: number;
  /** Oldest first, one per second, up to 60. */
  history: number[];
  at: number;
}

export interface CpuInfo {
  name: string;
  logicalCores: number;
  baseMhz: number | null;
  uptimeSecs: number;
  usage: number | null;
}

/** Accent below 60 %, warning to 85 %, then bad. */
export function loadColor(usage: number | undefined): string {
  if (usage === undefined) return "var(--g-accent)";
  if (usage >= 85) return "var(--g-bad)";
  if (usage >= 60) return "var(--g-warn)";
  return "var(--g-accent)";
}
