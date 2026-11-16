/**
 * Shared pieces of the media widgets: the now-playing and audio hooks (live topics, sample data
 * in picker previews), playback position, tile buttons, cover/app glyphs and the equaliser.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { Music } from "lucide-react";
import {
  siApplemusic,
  siDeezer,
  siDiscord,
  siFirefoxbrowser,
  siGooglechrome,
  siBrave,
  siOpera,
  siVivaldi,
  siSoundcloud,
  siSpotify,
  siTidal,
  siVlcmediaplayer,
  siYoutube,
  siYoutubemusic,
  siTwitch,
  siPlex,
  siFoobar2000,
  siSteam,
  siZoom,
  siTelegram,
  siWhatsapp,
} from "simple-icons";
import { call, useTopic } from "../../core/backend";
import { useIsVisible, useNow } from "../../core/useVisible";
import { cx } from "../../ui";
import "./media.css";
import { SAMPLE_AUDIO, SAMPLE_NOW_PLAYING } from "./samples";
import type { AudioState, MediaAction, NowPlaying } from "./types";

/** The session on screen. Picker previews get a sample track and subscribe to nothing. */
export function useNowPlaying(isSample: boolean): NowPlaying | undefined {
  const live = useTopic<NowPlaying>("media", "now_playing", { enabled: !isSample });
  return isSample ? SAMPLE_NOW_PLAYING : live;
}

/** Default output and input. */
export function useAudio(isSample: boolean): AudioState | undefined {
  const live = useTopic<AudioState>("media", "audio", { enabled: !isSample });
  return isSample ? SAMPLE_AUDIO : live;
}

export function hasTrack(np: NowPlaying | undefined): np is NowPlaying {
  return Boolean(np && np.active && (np.title || np.status === "playing" || np.status === "paused"));
}

export function isPlaying(np: NowPlaying | undefined): boolean {
  return np?.status === "playing";
}

/**
 * Where playback is now. Rust reports the position only when it changes, so while playing this
 * counts on from `updatedAt` (re-rendering once a second, only while visible).
 */
export function usePosition(np: NowPlaying | undefined): { pos: number; dur: number; frac: number } {
  const playing = isPlaying(np);
  const now = useNow(playing ? "second" : "minute");
  const dur = np?.durationMs ?? 0;
  if (!np || !dur) return { pos: 0, dur: 0, frac: 0 };
  const base = np.positionMs ?? 0;
  const pos = Math.min(dur, Math.max(0, playing ? base + (now.getTime() - np.updatedAt) * (np.rate || 1) : base));
  return { pos, dur, frac: pos / dur };
}

export function mediaControl(action: MediaAction, extra: { positionMs?: number; appId?: string } = {}): void {
  call("media", "control", { action, ...extra }).catch((e) => console.warn("media control failed", e));
}

/** "3:07" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * A button inside a tile. Stops the press from reaching the dock, so it neither opens the card
 * nor starts a drag.
 */
export function TileButton({
  label,
  onPress,
  disabled,
  className,
  style,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cx("g-press grid shrink-0 place-items-center rounded-full text-fg hover:bg-hover disabled:opacity-35 disabled:hover:bg-transparent", className)}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}

/** Three bars that bounce while playing. */
export function Equalizer({ playing, height, className }: { playing: boolean; height: number; className?: string }) {
  const visible = useIsVisible();
  const bar = Math.max(2, Math.round(height / 5));
  return (
    <span className={cx("glintbar-eq", (!playing || !visible) && "is-paused", className)} style={{ height, width: bar * 3 + 2 * Math.max(1, bar / 2), gap: Math.max(1, bar / 2) }} aria-hidden>
      <span style={{ width: bar }} />
      <span style={{ width: bar }} />
      <span style={{ width: bar }} />
    </span>
  );
}

interface Brand {
  path: string;
  hex: string;
}

const BRANDS: Array<[RegExp, Brand]> = [
  [/spotify/i, siSpotify],
  [/youtube ?music/i, siYoutubemusic],
  [/youtube/i, siYoutube],
  [/apple ?music|applemusic|itunes/i, siApplemusic],
  [/chrome/i, siGooglechrome],
  [/firefox|308046b0af4a39cb/i, siFirefoxbrowser],
  [/brave/i, siBrave],
  [/opera/i, siOpera],
  [/vivaldi/i, siVivaldi],
  [/vlc/i, siVlcmediaplayer],
  [/discord/i, siDiscord],
  [/tidal/i, siTidal],
  [/deezer/i, siDeezer],
  [/soundcloud/i, siSoundcloud],
  [/twitch/i, siTwitch],
  [/plex/i, siPlex],
  [/foobar/i, siFoobar2000],
  [/steam/i, siSteam],
  [/zoom/i, siZoom],
  [/telegram/i, siTelegram],
  [/whatsapp/i, siWhatsapp],
];

export function brandFor(...names: Array<string | undefined>): Brand | undefined {
  const hay = names.filter(Boolean).join(" ");
  return BRANDS.find(([re]) => re.test(hay))?.[1];
}

/** Brand colours that vanish on dark tiles are drawn in the text colour instead. */
function readable(hex: string): string | undefined {
  const n = parseInt(hex, 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l < 0.22 || l > 0.92 ? undefined : `#${hex}`;
}

/** The app's own logo, else its brand glyph, else a note. */
export function AppGlyph({ icon, appId, appName, size, mono }: { icon?: string | null; appId?: string; appName?: string; size: number; mono?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (icon && !broken) return <img src={icon} alt="" width={size} height={size} className="shrink-0 object-contain" onError={() => setBroken(true)} draggable={false} />;
  const brand = brandFor(appId, appName);
  if (brand) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden>
        <path d={brand.path} fill={mono ? "currentColor" : (readable(brand.hex) ?? "currentColor")} />
      </svg>
    );
  }
  return <Music size={size} className="shrink-0 text-dim" />;
}

/** Cover art, or the app's glyph on a soft square when the track has none. */
export function Cover({ np, size, radius, className }: { np: NowPlaying | undefined; size: number; radius?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const r = radius ?? Math.round(size * 0.18);
  const cover = np?.cover && np.cover !== failed ? np.cover : null;
  return (
    <div className={cx("relative grid shrink-0 place-items-center overflow-hidden bg-input", className)} style={{ width: size, height: size, borderRadius: r }}>
      {cover ? (
        <img src={cover} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setFailed(cover)} />
      ) : (
        <AppGlyph icon={np?.appIcon} appId={np?.appId} appName={np?.appName} size={Math.round(size * 0.52)} />
      )}
    </div>
  );
}

/**
 * Album-art accent: tints the tile with the cover's colour and makes it the tile's accent.
 * Returns an empty style when off or when there is no colour.
 */
export function accentStyle(np: NowPlaying | undefined, enabled: boolean): CSSProperties {
  const a = enabled && np?.accent && /^#[0-9a-f]{6}$/i.test(np.accent) ? np.accent : null;
  if (!a) return {};
  return {
    background: `color-mix(in srgb, ${a} 26%, var(--g-tile))`,
    borderColor: `color-mix(in srgb, ${a} 30%, transparent)`,
    ["--g-accent" as string]: a,
  };
}

/** Plain-language status for tiles with nothing to show. */
export function idleText(np: NowPlaying | undefined): string {
  if (np === undefined) return "Connecting…";
  return "Nothing playing";
}

export function artistLine(np: NowPlaying): string {
  return np.artist || np.album || np.appName;
}
