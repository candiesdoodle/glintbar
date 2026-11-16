/** Mirrors src-tauri/src/services/media (serde camelCase). */

export type PlaybackStatus = "playing" | "paused" | "stopped" | "changing" | "closed";

export interface OtherPlayer {
  appId: string;
  appName: string;
  title: string;
  playing: boolean;
}

/** `svc://media/now_playing` and `media.now_playing_get`. */
export interface NowPlaying {
  active: boolean;
  appId: string;
  appName: string;
  /** PNG data URL of the app's logo (Store apps). */
  appIcon: string | null;
  title: string;
  artist: string;
  album: string;
  /** PNG data URL, at most 240 px. */
  cover: string | null;
  /** Dominant colour of the cover, "#rrggbb". */
  accent: string | null;
  status: PlaybackStatus;
  positionMs: number | null;
  durationMs: number | null;
  /** Unix ms at which positionMs was true. */
  updatedAt: number;
  rate: number;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  others: OtherPlayer[];
}

export type MediaAction = "play_pause" | "play" | "pause" | "next" | "previous" | "seek" | "select";

/** One default device; volume 0-100. */
export interface AudioEndpoint {
  id: string;
  name: string;
  detail: string;
  volume: number;
  muted: boolean;
}

/** `svc://media/audio` and `media.audio_get`. */
export interface AudioState {
  output: AudioEndpoint | null;
  input: AudioEndpoint | null;
}

/** `media.outputs` */
export interface AudioDevice {
  id: string;
  name: string;
  detail: string;
  isDefault: boolean;
}

/** `media.apps`: one program in the mixer. */
export interface AppVolume {
  key: string;
  name: string;
  exe: string;
  pid: number;
  ids: string[];
  volume: number;
  muted: boolean;
  active: boolean;
  system: boolean;
}
