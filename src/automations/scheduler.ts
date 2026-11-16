/**
 * One-shot timers keyed by name, for things that must happen at a wall-clock time even while no
 * tile is visible (a timer ending, a reminder). Re-arming a key replaces the old timer. Long
 * delays are chained because setTimeout overflows past ~24.8 days.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_DELAY = 2_000_000_000;

export function scheduleAt(key: string, at: number, run: () => void): void {
  cancelScheduled(key);
  const arm = () => {
    const wait = at - Date.now();
    if (wait <= 0) {
      timers.delete(key);
      run();
      return;
    }
    timers.set(key, setTimeout(arm, Math.min(wait, MAX_DELAY)));
  };
  arm();
}

export function cancelScheduled(key: string): void {
  const t = timers.get(key);
  if (t !== undefined) clearTimeout(t);
  timers.delete(key);
}

/** Cancels every timer whose key starts with `prefix`. */
export function cancelPrefix(prefix: string): void {
  for (const key of [...timers.keys()]) if (key.startsWith(prefix)) cancelScheduled(key);
}
