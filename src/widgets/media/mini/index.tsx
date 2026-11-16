import { Pause, Play, Disc3 } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { Ring, TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { NOW_PLAYING_DEFAULTS, NowPlayingCard, type NowPlayingConfig } from "../NowPlayingCard";
import { accentStyle, hasTrack, isPlaying, mediaControl, TileButton, useNowPlaying, usePosition } from "../shared";

function MiniTile({ config, size, isSample }: TileProps<NowPlayingConfig>) {
  const np = useNowPlaying(isSample);
  const { frac } = usePosition(np);
  const playing = isPlaying(np);
  const track = hasTrack(np);
  const ring = Math.round(size * 0.8);
  const stroke = Math.max(2, Math.round(size * 0.07));
  const inner = ring - stroke * 2 - 2;
  return (
    <TileFrame padded={false} className="justify-center" style={accentStyle(np, config.albumAccent)} title={track ? `${np.title} - ${np.artist}` : "Nothing playing"}>
      <Ring value={track ? frac * 100 : 0} size={ring} stroke={stroke}>
        <TileButton
          label={playing ? "Pause" : "Play"}
          disabled={!track || !np.canPlayPause}
          onPress={() => {
            if (!isSample) mediaControl("play_pause");
          }}
          className="relative overflow-hidden bg-input disabled:opacity-60"
          style={{ width: inner, height: inner }}
        >
          {track && np.cover && <img src={np.cover} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-80" />}
          <span className={track && np.cover ? "relative grid place-items-center rounded-full bg-black/35 text-white" : "relative grid place-items-center"} style={{ width: inner * 0.62, height: inner * 0.62 }}>
            {!track ? (
              <Disc3 size={Math.round(inner * 0.42)} className="text-dim" />
            ) : playing ? (
              <Pause size={Math.round(inner * 0.34)} fill="currentColor" />
            ) : (
              <Play size={Math.round(inner * 0.34)} fill="currentColor" className="translate-x-[1px]" />
            )}
          </span>
        </TileButton>
      </Ring>
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget<NowPlayingConfig>({
  id: "media.mini",
  name: "Now Playing Mini",
  category: "Media & Audio",
  description: "One round play/pause button; its ring fills as the track plays.",
  keywords: ["music", "player", "play", "pause", "button", "progress", "media"],
  icon: Disc3,
  size: "s",
  Tile: MiniTile,
  Card: NowPlayingCard,
  cardSize: { width: 320 },
  defaultConfig: NOW_PLAYING_DEFAULTS,
});
