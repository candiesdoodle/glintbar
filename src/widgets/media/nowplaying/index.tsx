import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { NOW_PLAYING_DEFAULTS, NowPlayingCard, type NowPlayingConfig } from "../NowPlayingCard";
import { accentStyle, artistLine, Cover, Equalizer, hasTrack, idleText, isPlaying, mediaControl, TileButton, useNowPlaying, usePosition } from "../shared";

function NowPlayingTile({ config, size, isSample }: TileProps<NowPlayingConfig>) {
  const np = useNowPlaying(isSample);
  const { frac } = usePosition(np);
  const playing = isPlaying(np);
  const track = hasTrack(np);
  const cover = Math.round(size * 0.72);
  const btn = Math.round(size * 0.56);
  const icon = Math.round(size * 0.3);
  const roomy = size >= 40;
  // Nothing playing: no greyed-out buttons, so the words get the room.
  const idle = !track && np !== undefined && !isSample;
  const act = (a: "play_pause" | "next" | "previous") => {
    if (!isSample) mediaControl(a);
  };
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)] pr-[calc(var(--tile-h)*0.1)] pl-[calc(var(--tile-h)*0.14)]" style={accentStyle(np, config.albumAccent)} title={track ? `${np.title} - ${np.artist}` : "Now Playing"}>
      <Cover np={track ? np : undefined} size={cover} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1">
          {track && <Equalizer playing={playing} height={Math.round(size * 0.2)} className="text-accent" />}
          <div className="truncate font-semibold" style={{ fontSize: Math.max(10, Math.round(size * 0.27)) }}>
            {track ? np.title || np.appName : idleText(np)}
          </div>
        </div>
        <div className="truncate text-dim" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
          {track ? artistLine(np) : idle ? "Start a song or video" : "Songs and videos"}
        </div>
      </div>
      <div className={idle ? "hidden" : "flex shrink-0 items-center"}>
        {roomy && (
          <TileButton label="Previous" disabled={!track || !np.canPrevious} onPress={() => act("previous")} style={{ width: btn * 0.85, height: btn }}>
            <SkipBack size={icon * 0.85} fill="currentColor" />
          </TileButton>
        )}
        <TileButton label={playing ? "Pause" : "Play"} disabled={!track || !np.canPlayPause} onPress={() => act("play_pause")} style={{ width: btn, height: btn }}>
          {playing ? <Pause size={icon} fill="currentColor" /> : <Play size={icon} fill="currentColor" />}
        </TileButton>
        <TileButton label="Next" disabled={!track || !np.canNext} onPress={() => act("next")} style={{ width: btn * 0.85, height: btn }}>
          <SkipForward size={icon * 0.85} fill="currentColor" />
        </TileButton>
      </div>
      {track && np.durationMs ? (
        <div className="pointer-events-none absolute inset-x-[calc(var(--tile-h)*0.16)] bottom-[2px] h-[2px] overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-accent" style={{ width: `${frac * 100}%` }} />
        </div>
      ) : null}
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

export default defineWidget<NowPlayingConfig>({
  id: "media.nowplaying",
  name: "Now Playing",
  category: "Media & Audio",
  description: "Album art, track and artist, with back, play/pause and skip.",
  keywords: ["music", "spotify", "player", "song", "track", "album", "controls", "media"],
  icon: Music,
  size: "xl",
  Tile: NowPlayingTile,
  Card: NowPlayingCard,
  cardSize: { width: 320 },
  defaultConfig: NOW_PLAYING_DEFAULTS,
});
