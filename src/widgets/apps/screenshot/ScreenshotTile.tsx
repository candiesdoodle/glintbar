import { AppWindow, Camera, Monitor, SquareDashed, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { TileProps } from "../../../core/widget";
import { cx, Spinner, TileFrame } from "../../../ui";
import { capture, useShots, type CaptureMode, type ScreenshotConfig } from "./shared";

const MODES: Array<{ mode: CaptureMode; icon: LucideIcon; label: string }> = [
  { mode: "screen", icon: Monitor, label: "Screenshot of the whole screen" },
  { mode: "window", icon: AppWindow, label: "Screenshot of the active window" },
  { mode: "region", icon: SquareDashed, label: "Screenshot of a selected area" },
];

export function ScreenshotTile({ config, size, isSample }: TileProps<ScreenshotConfig>) {
  const last = useShots((s) => s.last);
  const busy = useShots((s) => s.busy);
  const seq = useShots((s) => s.seq);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (seq) setFlash(seq);
  }, [seq]);
  const btn = Math.round(size * 0.74);
  const icon = Math.round(size * 0.38);
  return (
    <TileFrame className="justify-between gap-[calc(var(--tile-h)*0.08)] px-[calc(var(--tile-h)*0.12)]" title="Screenshot">
      <div className="relative grid shrink-0 place-items-center overflow-hidden rounded-[22%] bg-input" style={{ width: btn, height: btn }}>
        {last?.thumb ? <img src={last.thumb} alt="" className="h-full w-full object-cover" /> : <Camera size={icon} className="text-dim" />}
        {flash > 0 && <span key={flash} className="glintbar-apps-shot absolute inset-0 bg-white" />}
      </div>
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          title={m.label}
          aria-label={m.label}
          disabled={isSample}
          className={cx("g-press grid shrink-0 place-items-center rounded-[22%] text-fg hover:bg-hover", busy === m.mode && "bg-accent/20 text-accent")}
          style={{ width: btn, height: btn }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void capture(m.mode, config, isSample);
          }}
        >
          {busy === m.mode ? <Spinner size={icon * 0.8} /> : <m.icon size={icon} strokeWidth={1.9} />}
        </button>
      ))}
    </TileFrame>
  );
}
