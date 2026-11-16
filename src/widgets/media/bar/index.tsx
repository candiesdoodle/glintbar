import { AudioLines, SkipForward } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { NOW_PLAYING_DEFAULTS, NowPlayingCard, type NowPlayingConfig } from "../NowPlayingCard";
import { accentStyle, clock, Equalizer, hasTrack, idleText, isPlaying, mediaControl, TileButton, useNowPlaying, usePosition } from "../shared";

function BarTile({ config, size, isSample }: TileProps<NowPlayingConfig>) {
  const np = useNowPlaying(isSample);
  const { pos, dur, frac } = usePosition(np);
  const playing = isPlaying(np);
  const track = hasTrack(np);
  const btn = Math.round(size * 0.56);
  const small = Math.max(9, Math.round(size * 0.21));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.12)] pr-[calc(var(--tile-h)*0.1)]" style={accentStyle(np, config.albumAccent)} title={track ? `${np.title} - ${np.artist}` : "Now Playing"}>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[calc(var(--tile-h)*0.1)] leading-none">
        <div className="flex min-w-0 items-center gap-1.5">
          {track && <Equalizer playing={playing} height={Math.round(size * 0.2)} className="text-accent" />}
          <div className="min-w-0 truncate" style={{ fontSize: Math.max(10, Math.round(size * 0.26)) }}>
            <span className="font-semibold">{track ? np.title || np.appName : idleText(np)}</span>
            {track && np.artist && <span className="text-dim"> · {np.artist}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-track">
            <div className="h-full rounded-full bg-accent" style={{ width: `${track ? frac * 100 : 0}%` }} />
          </div>
          {size >= 40 && dur > 0 && (
            <span className="shrink-0 text-faint tabular-nums" style={{ fontSize: small }}>
              {clock(pos)}
            </span>
          )}
        </div>
      </div>
      <TileButton
        label="Next"
        disabled={!track || !np.canNext}
        onPress={() => {
          if (!isSample) mediaControl("next");
        }}
        style={{ width: btn, height: btn }}
      >
        <SkipForward size={Math.round(size * 0.28)} fill="currentColor" />
      </TileButton>
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget<NowPlayingConfig>({
  id: "media.bar",
  name: "Now Playing Bar",
  category: "Media & Audio",
  description: "Track and artist above a progress bar, plus a next-track button.",
  keywords: ["music", "player", "progress", "skip", "next", "song", "media"],
  icon: AudioLines,
  size: "xl",
  Tile: BarTile,
  Card: NowPlayingCard,
  cardSize: { width: 320 },
  defaultConfig: NOW_PLAYING_DEFAULTS,
});
