import { bytes } from "../../../core/format";
import type { TileProps } from "../../../core/widget";
import { ProgressBar, TileFrame, TileSampleBadge } from "../../../ui";
import { fullIn, pickDrive, usageColor, usedShare, useDrives, useForecast, type StorageConfig } from "./shared";

export function StorageTile({ config, size, isSample }: TileProps<StorageConfig>) {
  const { drives, history, error } = useDrives(isSample);
  const d = pickDrive(drives, config.root);
  const days = useForecast(d, history, isSample);
  const share = d ? usedShare(d) : 0;
  const big = Math.max(10, Math.round(size * 0.27));
  const small = Math.max(8.5, Math.round(size * 0.2));
  const forecast = size < 40 && days !== null && fullIn(days) ? `Full in ${days}d` : fullIn(days);
  return (
    <TileFrame className="flex-col items-stretch justify-center gap-[calc(var(--tile-h)*0.07)]" title={d ? `${d.letter}: ${bytes(d.free)} free of ${bytes(d.total)}` : "Storage"}>
      <div className="flex min-w-0 items-baseline gap-[0.3em] leading-none whitespace-nowrap">
        <span className="font-semibold tabular-nums" style={{ fontSize: big }}>
          {d ? bytes(d.free, d.free >= 10 * 1024 ** 3 ? 0 : 1) : error ? "Unavailable" : "…"}
        </span>
        {d && (
          <span className="truncate text-dim" style={{ fontSize: small }}>
            free
          </span>
        )}
      </div>
      <ProgressBar value={share * 100} color={usageColor(share)} height={Math.max(3, Math.round(size * 0.09))} />
      {size >= 34 && (
        <div className="truncate leading-none text-dim" style={{ fontSize: small }}>
          {d ? (forecast ?? `${d.letter}: ${Math.round(share * 100)}% used`) : " "}
        </div>
      )}
      {isSample && <TileSampleBadge />}
    </TileFrame>
  );
}
