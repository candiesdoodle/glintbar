import { Music, Pause, Play } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { NOW_PLAYING_DEFAULTS, NowPlayingCard, type NowPlayingConfig } from "../NowPlayingCard";
import { accentStyle, artistLine, hasTrack, idleText, isPlaying, mediaControl, TileButton, useNowPlaying } from "../shared";

function CompactTile({ config, size, isSample }: TileProps<NowPlayingConfig>) {
  const np = useNowPlaying(isSample);
  const playing = isPlaying(np);
  const track = hasTrack(np);
  const btn = Math.round(size * 0.66);
  const idle = !track && np !== undefined && !isSample;
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.1)] pr-[calc(var(--tile-h)*0.12)]" style={accentStyle(np, config.albumAccent)} title={track ? `${np.title} - ${np.artist}` : "Now Playing"}>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-semibold" style={{ fontSize: Math.max(10, Math.round(size * 0.27)) }}>
          {track ? np.title || np.appName : idleText(np)}
        </div>
        <div className="truncate text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
          {track ? artistLine(np) : "Play something"}
        </div>
      </div>
      {!idle && (
      <TileButton
        label={playing ? "Pause" : "Play"}
        disabled={!track || !np.canPlayPause}
        onPress={() => {
          if (!isSample) mediaControl("play_pause");
        }}
        className="bg-accent text-on-accent hover:bg-accent hover:brightness-110"
        style={{ width: btn, height: btn }}
      >
        {playing ? <Pause size={Math.round(btn * 0.46)} fill="currentColor" /> : <Play size={Math.round(btn * 0.46)} fill="currentColor" className="translate-x-[1px]" />}
      </TileButton>
      )}
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget<NowPlayingConfig>({
  id: "media.compact",
  name: "Now Playing (compact)",
  category: "Media & Audio",
  description: "A smaller now-playing tile: song title, artist and a play/pause button.",
  keywords: ["music", "spotify", "player", "song", "pause", "small", "media"],
  icon: Music,
  size: "l",
  Tile: CompactTile,
  Card: NowPlayingCard,
  cardSize: { width: 320 },
  defaultConfig: NOW_PLAYING_DEFAULTS,
});
