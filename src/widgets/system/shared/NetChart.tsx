import { useEffect, useId, useRef } from "react";

/** Rounds a scale up to 1 / 2 / 5 x 10^n bytes per second (at least 64 KB/s). */
export function niceMax(v: number): number {
  const x = Math.max(64 * 1024, v);
  // Round in KB or MB so the label reads "10 MB/s", not "9.5 MB/s".
  const unit = x >= 1000 * 1024 ? 1024 * 1024 : 1024;
  const y = x / unit;
  const p = 10 ** Math.floor(Math.log10(y));
  for (const m of [1, 2, 5, 10]) if (m * p >= y) return m * p * unit;
  return 10 * p * unit;
}

/**
 * Download (filled, accent) and upload (line, dim) speeds. Each new sample moves the chart one
 * slot to the left. It glides there over a second only while someone is looking (pointer on the
 * tile, or in the card); on an idle dock it steps, because a scroll restarted every second is a
 * repaint on every frame.
 */
export function NetChart({
  down,
  up,
  at,
  slots = 30,
  height,
  className,
  grid = false,
}: {
  down: number[];
  up: number[];
  at: number | undefined;
  slots?: number;
  height: number;
  className?: string;
  grid?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const g = useRef<SVGGElement>(null);
  const W = 100;
  const H = 100;
  const step = W / Math.max(1, slots - 1);
  const d = down.slice(-(slots + 1));
  const u = up.slice(-(slots + 1));
  const max = niceMax(Math.max(0, ...d, ...u));

  useEffect(() => {
    const el = g.current;
    if (!el || at === undefined || typeof el.animate !== "function") return;
    const tile = el.closest("[data-glintbar-tile]");
    let hovered = false;
    try {
      hovered = tile !== null && tile.matches(":hover");
    } catch {
      /* no :hover support (tests) */
    }
    const watched = hovered || el.closest(".g-panel") !== null;
    if (!watched) return;
    const anim = el.animate([{ transform: `translateX(${step}px)` }, { transform: "translateX(0px)" }], { duration: 1000, easing: "linear" });
    return () => anim.cancel();
  }, [at, step]);


  const pts = (arr: number[]) => arr.map((v, i) => [W - (arr.length - 1 - i) * step, H - Math.min(1, v / max) * H * 0.94] as const);
  const line = (arr: number[]) =>
    pts(arr)
      .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
  const area = (arr: number[]) => {
    if (arr.length < 2) return "";
    const p = pts(arr);
    return `${line(arr)} L${p[p.length - 1][0].toFixed(2)},${H} L${p[0][0].toFixed(2)},${H} Z`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} style={{ height, width: "100%", display: "block", overflow: "hidden" }} aria-hidden>
      <defs>
        <linearGradient id={`n${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--g-accent)" stopOpacity={0.42} />
          <stop offset="1" stopColor="var(--g-accent)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {grid &&
        [0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--g-track)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      <g ref={g}>
        {d.length > 1 && <path d={area(d)} fill={`url(#n${id})`} />}
        {d.length > 1 && <path d={line(d)} fill="none" stroke="var(--g-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {u.length > 1 && (
          <path d={line(u)} fill="none" stroke="var(--g-dim)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="3 2" />
        )}
      </g>
    </svg>
  );
}
