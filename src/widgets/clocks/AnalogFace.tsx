/** An analog clock face as SVG: hour ticks, hour and minute hands, optional second hand. */
export function AnalogFace({
  hour,
  minute,
  second,
  size,
  face = "var(--g-input)",
  rim = "var(--g-track)",
  ticks = "var(--g-dim)",
  hands = "var(--g-fg)",
  secondColor = "var(--g-accent)",
  minuteTicks = false,
}: {
  hour: number;
  minute: number;
  second?: number;
  size: number;
  face?: string;
  rim?: string;
  ticks?: string;
  hands?: string;
  secondColor?: string;
  minuteTicks?: boolean;
}) {
  const hourDeg = ((hour % 12) + minute / 60) * 30;
  const minuteDeg = (minute + (second ?? 0) / 60) * 6;
  const secondDeg = (second ?? 0) * 6;
  const sw = size < 40 ? 1.4 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0" aria-hidden>
      <circle cx="50" cy="50" r="48" fill={face} stroke={rim} strokeWidth="2" />
      {Array.from({ length: minuteTicks ? 60 : 12 }, (_, i) => {
        const major = minuteTicks ? i % 5 === 0 : true;
        const a = (i * (minuteTicks ? 6 : 30) * Math.PI) / 180;
        const r1 = major ? 37 : 41;
        const r2 = 44;
        return (
          <line
            key={i}
            x1={50 + r1 * Math.sin(a)}
            y1={50 - r1 * Math.cos(a)}
            x2={50 + r2 * Math.sin(a)}
            y2={50 - r2 * Math.cos(a)}
            stroke={ticks}
            strokeWidth={(major ? (i % (minuteTicks ? 15 : 3) === 0 ? 4 : 2.6) : 1.2) * sw}
            strokeLinecap="round"
          />
        );
      })}
      <line x1="50" y1="54" x2="50" y2="27" stroke={hands} strokeWidth={6 * sw} strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
      <line x1="50" y1="56" x2="50" y2="14" stroke={hands} strokeWidth={4 * sw} strokeLinecap="round" transform={`rotate(${minuteDeg} 50 50)`} />
      {second !== undefined && <line x1="50" y1="60" x2="50" y2="12" stroke={secondColor} strokeWidth={1.8 * sw} strokeLinecap="round" transform={`rotate(${secondDeg} 50 50)`} />}
      <circle cx="50" cy="50" r={4 * sw} fill={second !== undefined ? secondColor : hands} />
    </svg>
  );
}
