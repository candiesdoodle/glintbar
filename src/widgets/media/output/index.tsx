import { Headphones, Volume2, VolumeX } from "lucide-react";
import type { WheelEvent } from "react";
import { defineWidget, type TileProps, lazyPart } from "../../../core/widget";
import { clamp, cx, TileFrame, TileNotice } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { useAudio } from "../shared";
import { deviceIcon, setMuted, setVolume, useOptimistic, volumeIcon } from "../volume";

function OutputTile({ size, isSample }: TileProps) {
  const audio = useAudio(isSample);
  const out = audio?.output ?? null;
  const [volume, change] = useOptimistic(out?.volume, (v) => {
    if (!isSample) setVolume(v);
  });
  const vol = Math.round(volume ?? 0);
  const muted = Boolean(out?.muted);
  // Headphones get their own glyph; speakers show the volume level.
  const Icon = !out ? Volume2 : muted || vol <= 0 ? volumeIcon(vol, muted) : deviceIcon(out.name, out.detail) === Headphones ? Headphones : volumeIcon(vol, muted);
  const circle = Math.round(size * 0.58);

  const onWheel = (e: WheelEvent) => {
    // Scrolling over this tile changes the volume instead of scrolling the dock.
    e.stopPropagation();
    if (!out || e.deltaY === 0) return;
    const step = e.shiftKey ? 1 : 2;
    change(clamp(vol + (e.deltaY < 0 ? step : -step), 0, 100));
  };

  if (audio && !out) return <TileNotice icon={VolumeX} title="No sound" detail="No speakers" size={size} narrow hint="Windows reports no speakers or headphones" />;

  return (
    <div className="h-full w-full" onWheel={onWheel}>
      <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={out ? `${out.name}${out.detail ? ` (${out.detail})` : ""}: ${muted ? "muted" : `${vol}%`}. Scroll to adjust, click the icon to mute.` : "Sound"}>
        {/* The icon is the mute switch; the rest of the tile opens the card. */}
        <button
          type="button"
          disabled={!out}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          title={muted ? "Unmute" : "Mute"}
          className={cx("g-press grid shrink-0 place-items-center rounded-full", muted ? "bg-bad/15 text-bad hover:bg-bad/25" : "bg-accent/15 text-accent hover:bg-accent/25")}
          style={{ width: circle, height: circle }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (out && !isSample) setMuted(!muted).catch((err) => console.warn("set_muted failed", err));
          }}
        >
          <Icon size={Math.round(circle * 0.5)} />
        </button>
        <div className="min-w-0 flex-1 leading-none">
          <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.34) }}>
            {!out ? (audio === undefined ? "–" : "Off") : muted ? "Muted" : `${vol}%`}
          </div>
          <div className="mt-[3px] truncate text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
            {out ? out.name : audio === undefined ? "Sound" : "No device"}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-[calc(var(--tile-h)*0.2)] bottom-[3px] h-[2px] overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${muted ? 0 : vol}%`, background: "var(--g-accent)" }} />
        </div>
        {isSample && <TileSampleBadge size={size} />}
      </TileFrame>
    </div>
  );
}

export default defineWidget({
  id: "media.output",
  name: "Audio Output",
  category: "Media & Audio",
  description: "Speaker or headphone volume; scroll over it to adjust, click its icon to mute.",
  keywords: ["volume", "sound", "speakers", "headphones", "mixer", "mute", "output", "device"],
  icon: Volume2,
  size: "m",
  Tile: OutputTile,
  Card: lazyPart(() => import("./OutputCard").then((m) => m.OutputCard)),
  cardSize: { width: 330 },
});
