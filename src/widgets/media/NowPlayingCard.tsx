import { useEffect, useRef, useState } from "react";
import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { CardProps } from "../../core/widget";
import { CardFrame, cx, EmptyState, ListRow, Section, SettingRow, Slider, Toggle } from "../../ui";
import { AppGlyph, artistLine, clock, Cover, Equalizer, hasTrack, isPlaying, mediaControl, useNowPlaying, usePosition } from "./shared";

export type NowPlayingConfig = {
  /** Tint the tile with the cover's colour. */
  albumAccent: boolean;
};

export const NOW_PLAYING_DEFAULTS: NowPlayingConfig = { albumAccent: false };

/** The card every now-playing tile opens: big cover, seek bar, controls, other players. */
export function NowPlayingCard({ config, setConfig, isSample }: CardProps<NowPlayingConfig>) {
  const np = useNowPlaying(isSample);
  const { pos, dur } = usePosition(np);
  const playing = isPlaying(np);
  const [seek, setSeek] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onSeek = (sec: number) => {
    setSeek(sec);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!isSample) mediaControl("seek", { positionMs: sec * 1000 });
      // Let the next timeline event take over shortly after.
      setTimeout(() => setSeek(null), 600);
    }, 220);
  };

  const shownPos = seek !== null ? seek * 1000 : pos;
  const act = (a: "play_pause" | "next" | "previous") => {
    if (!isSample) mediaControl(a);
  };

  return (
    <CardFrame title="Now Playing" subtitle={hasTrack(np) ? `From ${np.appName}` : "Media from any app Windows can control"} icon={Music}>
      {!hasTrack(np) ? (
        <EmptyState
          icon={Music}
          title={np === undefined ? "Searching for media apps…" : "No media playing"}
          message="When an app shows playback controls in the Windows media flyout, its track appears here. Start something to see it."
        />
      ) : (
        <>
          <div className="flex flex-col items-center pt-1">
            <div className="relative">
              <Cover np={np} size={196} radius={18} className="shadow-[0_10px_30px_rgba(0,0,0,0.35)]" />
              {np.cover && (
                <div className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 backdrop-blur-sm">
                  <AppGlyph icon={np.appIcon} appId={np.appId} appName={np.appName} size={15} mono />
                </div>
              )}
            </div>
            <div className="mt-3 flex w-full items-center justify-center gap-2">
              <Equalizer playing={playing} height={12} className="text-accent" />
              <div className="min-w-0 truncate text-[15px] font-semibold" title={np.title}>
                {np.title || "Unknown title"}
              </div>
            </div>
            <div className="w-full truncate text-center text-[12.5px] text-dim" title={[np.artist, np.album].filter(Boolean).join(" · ")}>
              {[artistLine(np), np.album && np.album !== artistLine(np) ? np.album : ""].filter(Boolean).join(" · ")}
            </div>
          </div>

          {dur > 0 && (
            <div className="mt-2.5">
              <Slider label="Position" value={Math.round(shownPos / 1000)} min={0} max={Math.max(1, Math.round(dur / 1000))} onChange={onSeek} className={cx(!np.canSeek && "pointer-events-none opacity-70")} />
              <div className="-mt-0.5 flex justify-between text-[11px] text-faint tabular-nums">
                <span>{clock(shownPos)}</span>
                <span>-{clock(dur - shownPos)}</span>
              </div>
            </div>
          )}

          <div className="mt-1.5 mb-3 flex items-center justify-center gap-5">
            <button type="button" aria-label="Previous" title="Previous" disabled={!np.canPrevious} onClick={() => act("previous")} className="g-press grid h-10 w-10 place-items-center rounded-full text-fg hover:bg-hover disabled:opacity-30">
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button type="button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} disabled={!np.canPlayPause} onClick={() => act("play_pause")} className="g-press grid h-12 w-12 place-items-center rounded-full bg-accent text-on-accent shadow-md hover:brightness-110 disabled:opacity-40">
              {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-[1px]" />}
            </button>
            <button type="button" aria-label="Next" title="Next" disabled={!np.canNext} onClick={() => act("next")} className="g-press grid h-10 w-10 place-items-center rounded-full text-fg hover:bg-hover disabled:opacity-30">
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>

          {np.others.length > 0 && (
            <Section title="Other players">
              <div className="-mx-2 py-1">
                {np.others.map((o) => (
                  <ListRow
                    key={o.appId}
                    leading={<AppGlyph appId={o.appId} appName={o.appName} size={16} />}
                    title={o.appName}
                    subtitle={o.title || (o.playing ? "Playing" : "Paused")}
                    right={o.playing ? <Equalizer playing height={10} className="text-accent" /> : "Show"}
                    onClick={() => {
                      if (!isSample) mediaControl("select", { appId: o.appId });
                    }}
                  />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      <Section title="This tile" className="mb-0">
        <SettingRow label="Tint from album art" description="Colours the tile background using the album art.">
          <Toggle checked={config.albumAccent} onChange={(albumAccent) => setConfig({ albumAccent })} />
        </SettingRow>
      </Section>
    </CardFrame>
  );
}
