import type { Block, DayLine } from "./data";

const DAY = 86_400_000;

function Blocks({ blocks, className, minWidthPct = 0.25 }: { blocks: Block[]; className: string; minWidthPct?: number }) {
  return (
    <>
      {blocks.map((b, i) => (
        <div key={i} title={b.label} className={"absolute " + className} style={{ left: `${b.from * 100}%`, width: `${Math.max(minWidthPct, (b.to - b.from) * 100)}%`, background: b.color }} />
      ))}
    </>
  );
}

/** The day as one horizontal line: night shading, app use by kind, focus rounds, meetings, now. */
export function Track({ line, dayStart, now, height, showLanes }: { line: DayLine; dayStart: number; now: number; height: number; showLanes?: boolean }) {
  const rise = line.sunrise !== null ? (line.sunrise - dayStart) / DAY : null;
  const set = line.sunset !== null ? (line.sunset - dayStart) / DAY : null;
  const nowFrac = Math.min(1, Math.max(0, (now - dayStart) / DAY));
  const laneH = Math.max(3, Math.round(height * 0.16));
  return (
    <div className="relative w-full" style={{ height }}>
      {/* night / day background */}
      <div className="absolute inset-x-0 overflow-hidden rounded-[4px] bg-track" style={{ top: laneH + 2, bottom: showLanes ? laneH + 2 : 0 }}>
        {rise !== null && set !== null && (
          <div className="absolute inset-y-0" style={{ left: `${rise * 100}%`, width: `${(set - rise) * 100}%`, background: "color-mix(in srgb, var(--g-warn) 14%, transparent)" }} />
        )}
        <Blocks blocks={line.apps} className="inset-y-0" minWidthPct={0.15} />
      </div>
      {/* focus (above) and meetings (below, or above beside focus when compact) */}
      <div className="absolute inset-x-0 top-0" style={{ height: laneH }}>
        <Blocks blocks={line.focus} className="inset-y-0 rounded-full" />
        {!showLanes && <Blocks blocks={line.meetings} className="inset-y-0 rounded-full opacity-90" />}
      </div>
      {showLanes && (
        <div className="absolute inset-x-0 bottom-0" style={{ height: laneH }}>
          <Blocks blocks={line.meetings} className="inset-y-0 rounded-full" />
        </div>
      )}
      {rise !== null && <div className="absolute w-px bg-warn/70" style={{ left: `${rise * 100}%`, top: laneH, bottom: showLanes ? laneH : 0 }} />}
      {set !== null && <div className="absolute w-px bg-warn/70" style={{ left: `${set * 100}%`, top: laneH, bottom: showLanes ? laneH : 0 }} />}
      <div className="absolute -top-px -bottom-px w-[2px] rounded-full bg-fg" style={{ left: `calc(${nowFrac * 100}% - 1px)` }} />
    </div>
  );
}
