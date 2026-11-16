/** Formatting used by several system tiles. */

/** Bytes per second -> "0 KB/s", "640 KB/s", "1.2 MB/s", "18 MB/s". */
export function rate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return "–";
  const kb = bps / 1024;
  if (kb < 1000) return `${Math.round(kb)} KB/s`;
  const mb = kb / 1024;
  if (mb < 10) return `${mb.toFixed(1)} MB/s`;
  if (mb < 1000) return `${Math.round(mb)} MB/s`;
  return `${(mb / 1024).toFixed(1)} GB/s`;
}

/** Split for big-number layouts: { value: "1.2", unit: "MB/s" }. */
export function rateParts(bps: number): { value: string; unit: string } {
  const [value, unit] = rate(bps).split(" ");
  return { value, unit: unit ?? "" };
}

/** Memory for tiles: "640 MB", "1.2 GB", "12 GB". */
export function mem(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  const mb = bytes / 2 ** 20;
  if (mb < 1000) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}

/** Link speed in bits per second -> "1 Gbps", "866 Mbps". */
export function linkSpeed(bitsPerSecond: number): string {
  if (!bitsPerSecond) return "";
  const mbps = bitsPerSecond / 1e6;
  if (mbps >= 1000) return `${+(mbps / 1000).toFixed(1)} Gbps`;
  return `${Math.round(mbps)} Mbps`;
}

export type TempUnit = "c" | "f";

export function toUnit(celsius: number, unit: TempUnit): number {
  return unit === "f" ? celsius * 1.8 + 32 : celsius;
}

export function temp(celsius: number | undefined, unit: TempUnit, withUnit = true): string {
  if (celsius === undefined || !Number.isFinite(celsius)) return "–";
  const v = Math.round(toUnit(celsius, unit));
  return withUnit ? `${v}°${unit.toUpperCase()}` : `${v}°`;
}

/** Accent while cool, warning from 70 °C, bad from 85 °C. */
export function tempColor(celsius: number | undefined): string {
  if (celsius === undefined) return "var(--g-accent)";
  if (celsius >= 85) return "var(--g-bad)";
  if (celsius >= 70) return "var(--g-warn)";
  return "var(--g-accent)";
}

/** Battery colour: good while charging, bad at 15 % and below, warning to 30 %. */
export function batteryColor(percent: number | null | undefined, charging: boolean): string {
  if (charging) return "var(--g-good)";
  if (percent === null || percent === undefined) return "var(--g-accent)";
  if (percent <= 15) return "var(--g-bad)";
  if (percent <= 30) return "var(--g-warn)";
  return "var(--g-accent)";
}

/** Font size helper: a fraction of the tile height with a floor. */
export function fs(size: number, k: number, min = 8): number {
  return Math.max(min, Math.round(size * k));
}
