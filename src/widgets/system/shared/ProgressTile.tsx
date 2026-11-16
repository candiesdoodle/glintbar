import { ProgressBar, TileFrame } from "../../../ui";
import { fs } from "./format";
import { pctText } from "./progress";

/** Label + percent over a progress bar (Day and Month Progress). */
export function ProgressTile({ size, label, fraction, title }: { size: number; label: string; fraction: number; title: string }) {
  return (
    <TileFrame className="flex-col items-stretch justify-center gap-[calc(var(--tile-h)*0.12)]" title={title}>
      <div className="flex items-baseline justify-between gap-2 leading-none">
        <span className="truncate text-dim" style={{ fontSize: fs(size, 0.22, 9) }}>
          {label}
        </span>
        <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.3) }}>
          {pctText(fraction)}
        </span>
      </div>
      <ProgressBar value={fraction * 100} height={Math.max(3, Math.round(size * 0.12))} />
    </TileFrame>
  );
}
