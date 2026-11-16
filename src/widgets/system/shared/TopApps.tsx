import { useMemo } from "react";
import { call } from "../../../core/backend";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { fs, mem } from "./format";
import { useProcs, useTileAction } from "./hooks";
import type { AppUsage } from "./types";

const openTaskManager = () => {
  call("shell", "open", { target: "taskmgr.exe" }).catch(() => {});
};

/** The Top CPU / Top RAM tile: the busiest apps as rows with a share bar behind each. */
export function TopAppsTile({ kind, size, isSample }: Pick<TileProps, "size" | "isSample"> & { kind: "cpu" | "ram" }) {
  const sample = useProcs();
  const rows: AppUsage[] | undefined = kind === "cpu" ? sample?.cpu : sample?.ram;
  const count = size < 40 ? 2 : 3;
  const shown = (rows ?? []).slice(0, count);
  const font = fs(size, 0.2, 8);
  const rowH = Math.floor((size - 8) / count);
  const act = useTileAction(isSample, openTaskManager);
  const scale = useMemo(() => {
    if (!rows?.length) return 1;
    return kind === "cpu" ? Math.max(10, rows[0].cpu) : Math.max(1, rows[0].memory);
  }, [rows, kind]);
  const value = (a: AppUsage) => (kind === "cpu" ? `${a.cpu < 10 ? a.cpu.toFixed(1) : Math.round(a.cpu)}%` : mem(a.memory));
  const title =
    (kind === "cpu" ? "Top CPU" : "Top memory") +
    (shown.length ? "\n" + shown.map((a) => `${a.name}: ${value(a)}`).join("\n") : "") +
    "\nClick for Task Manager";

  return (
    <div className="h-full w-full" {...act}>
      <TileFrame padded={false} className="flex-col justify-center gap-[2px] px-[calc(var(--tile-h)*0.12)]" title={title}>
        {shown.length === 0 ? (
          <div className="flex w-full flex-col gap-[3px]">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="flex items-center justify-between rounded-[4px] bg-track/60 px-1" style={{ height: rowH - 2 }}>
                <span className="text-faint" style={{ fontSize: font }}>
                  {i === 0 ? (sample ? "Measuring…" : "…") : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          shown.map((a) => {
            const share = kind === "cpu" ? a.cpu / scale : a.memory / scale;
            return (
              <div key={a.exe + a.name} className="relative flex w-full items-center justify-between gap-1.5 overflow-hidden rounded-[4px] px-1" style={{ height: rowH - 2 }}>
                <div className="absolute inset-y-0 left-0 rounded-[4px] bg-accent/15 transition-[width] duration-700" style={{ width: `${Math.max(4, Math.min(100, share * 100))}%` }} />
                <span className="relative min-w-0 truncate text-dim" style={{ fontSize: font }}>
                  {a.name}
                </span>
                <span className="relative shrink-0 font-semibold tabular-nums text-fg" style={{ fontSize: font }}>
                  {value(a)}
                </span>
              </div>
            );
          })
        )}
      </TileFrame>
    </div>
  );
}
