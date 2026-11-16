import type { ContribDay } from "./github";

/** Splits days (oldest first) into Sunday-first weeks. */
export function toWeeks(days: ContribDay[]): Array<Array<ContribDay | null>> {
  const weeks: Array<Array<ContribDay | null>> = [];
  let cur: Array<ContribDay | null> = [];
  for (const d of days) {
    const [y, m, dd] = d.date.split("-").map(Number);
    const dow = new Date(y, m - 1, dd).getDay();
    if (dow === 0 && cur.length) {
      weeks.push(cur);
      cur = [];
    }
    if (!cur.length) for (let i = 0; i < dow; i++) cur.push(null);
    cur.push(d);
  }
  if (cur.length) weeks.push(cur);
  return weeks;
}

const OPACITY = [0, 0.32, 0.55, 0.78, 1];

/** A GitHub-style grid of the last `weeks` weeks, in the theme's accent. */
export function ContributionGrid({ days, weeks, cell, gap = 1, title }: { days: ContribDay[]; weeks: number; cell: number; gap?: number; title?: (d: ContribDay) => string }) {
  const all = toWeeks(days);
  const shown = all.slice(Math.max(0, all.length - weeks));
  return (
    <div className="flex shrink-0" style={{ gap }} aria-hidden={!title}>
      {shown.map((w, i) => (
        <div key={i} className="flex flex-col" style={{ gap }}>
          {Array.from({ length: 7 }, (_, j) => {
            const d = w[j];
            const level = d ? d.level : -1;
            return (
              <span
                key={j}
                title={d && title ? title(d) : undefined}
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: Math.max(1, Math.round(cell / 4)),
                  background: level <= 0 ? (level === 0 ? "var(--g-track)" : "transparent") : "var(--g-accent)",
                  opacity: level > 0 ? OPACITY[level] : 1,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
