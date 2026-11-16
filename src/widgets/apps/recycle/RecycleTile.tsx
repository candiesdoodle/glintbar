import { useState } from "react";
import { call } from "../../../core/backend";
import { shortNumber } from "../../../core/format";
import type { TileProps } from "../../../core/widget";
import { cx, TileFrame, TileSampleBadge } from "../../../ui";
import { useFileDrop } from "../shared/dragdrop";
import { BinArt, describeBin, fullness, useBin } from "./shared";

export function RecycleTile({ instanceId, size, isSample }: TileProps) {
  const bin = useBin(isSample);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  useFileDrop(`recycle:${instanceId}`, (ev) => {
    if (isSample) return;
    if (ev.type === "over") setOver(true);
    else if (ev.type === "leave") setOver(false);
    else {
      setOver(false);
      if (!ev.paths.length) return;
      setBusy(true);
      call("apps", "recycle_files", { paths: ev.paths })
        .catch((e) => console.warn("apps: recycle failed", e))
        .finally(() => setBusy(false));
    }
  });
  const count = bin?.count ?? 0;
  return (
    <div data-glintbar-drop={`recycle:${instanceId}`} className="h-full w-full">
      <TileFrame padded={false} className={cx("justify-center", over && "ring-2 ring-accent")} title={`Recycle Bin: ${describeBin(bin)}`}>
        <BinArt size={Math.round(size * 0.66)} fill={fullness(bin)} active={over || busy} />
        {count > 0 && (
          <span
            className="absolute rounded-full bg-accent px-[4px] font-semibold text-on-accent tabular-nums"
            style={{ top: Math.max(2, size * 0.05), right: Math.max(2, size * 0.05), fontSize: Math.max(8, size * 0.18), lineHeight: 1.3 }}
          >
            {shortNumber(count)}
          </span>
        )}
        {isSample && <TileSampleBadge />}
      </TileFrame>
    </div>
  );
}
