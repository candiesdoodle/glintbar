/** Calendar progress, local time. */

export function dayProgress(d: Date): number {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return (d.getTime() - start) / (end - start);
}

export function monthProgress(d: Date): number {
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return (d.getTime() - start) / (end - start);
}

export function yearProgress(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1).getTime();
  const end = new Date(d.getFullYear() + 1, 0, 1).getTime();
  return (d.getTime() - start) / (end - start);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function daysInYear(year: number): number {
  return (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) / 86_400_000;
}

/** 1-based day of the year. */
export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** "42%" with one decimal under 10 %. */
export function pctText(fraction: number): string {
  const p = Math.max(0, Math.min(1, fraction)) * 100;
  return p < 10 ? `${p.toFixed(1)}%` : `${Math.floor(p)}%`;
}
