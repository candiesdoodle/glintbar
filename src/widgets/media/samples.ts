/** Sample tracks and devices: browser preview (mock.ts) and picker previews. */
import type { AppVolume, AudioDevice, AudioState, NowPlaying } from "./types";

/** An abstract album cover as an SVG data URL. */
export function sampleCover(a: string, b: string, c: string, variant: number): string {
  const shapes = [
    `<circle cx="70" cy="58" r="34" fill="${c}" opacity=".9"/><circle cx="34" cy="92" r="20" fill="#fff" opacity=".18"/>`,
    `<rect x="18" y="18" width="64" height="64" rx="6" fill="none" stroke="${c}" stroke-width="6" transform="rotate(12 50 50)"/><circle cx="50" cy="50" r="10" fill="#fff" opacity=".7"/>`,
    `<path d="M0 72 Q25 52 50 70 T100 64 V100 H0Z" fill="${c}" opacity=".85"/><circle cx="72" cy="30" r="12" fill="#fff" opacity=".85"/>`,
    `<g fill="none" stroke="${c}" stroke-width="3" opacity=".9"><circle cx="50" cy="50" r="14"/><circle cx="50" cy="50" r="26"/><circle cx="50" cy="50" r="38"/></g>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>${shapes[variant % shapes.length]}</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export interface SampleTrack {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  cover: string;
  accent: string;
}

export const SAMPLE_TRACKS: SampleTrack[] = [
  { title: "Harbour Lights", artist: "The Paper Kites Collective", album: "Low Tide", durationMs: 214_000, cover: sampleCover("#1d2b64", "#f8cdda", "#ff8a65", 0), accent: "#ff8a65" },
  { title: "Glass Garden", artist: "Mira Okafor", album: "Greenhouse", durationMs: 187_000, cover: sampleCover("#0f3d3e", "#7fd1ae", "#ffe08a", 2), accent: "#3fb88a" },
  { title: "Night Shift", artist: "Halcyon Drive", album: "Afterhours", durationMs: 243_000, cover: sampleCover("#2b0f3a", "#c94b7c", "#ffd36e", 1), accent: "#d2557f" },
  { title: "Slow Orbit", artist: "Juniper & Vale", album: "Satellites", durationMs: 198_000, cover: sampleCover("#0b1d3a", "#3a7bd5", "#9be7ff", 3), accent: "#4f8fe0" },
];

export function nowPlayingFrom(t: SampleTrack, positionMs: number, playing: boolean): NowPlaying {
  return {
    active: true,
    appId: "Spotify.exe",
    appName: "Spotify",
    appIcon: null,
    title: t.title,
    artist: t.artist,
    album: t.album,
    cover: t.cover,
    accent: t.accent,
    status: playing ? "playing" : "paused",
    positionMs,
    durationMs: t.durationMs,
    updatedAt: Date.now(),
    rate: 1,
    canPlayPause: true,
    canNext: true,
    canPrevious: true,
    canSeek: true,
    others: [{ appId: "Chrome", appName: "Google Chrome", title: "Morning jazz radio", playing: false }],
  };
}

/** What picker previews show. */
export const SAMPLE_NOW_PLAYING: NowPlaying = nowPlayingFrom(SAMPLE_TRACKS[0], 81_000, true);

export const SAMPLE_AUDIO: AudioState = {
  output: { id: "out-1", name: "Speakers", detail: "Realtek(R) Audio", volume: 42, muted: false },
  input: { id: "in-1", name: "Microphone", detail: "USB Audio Device", volume: 78, muted: false },
};

export const SAMPLE_OUTPUTS: AudioDevice[] = [
  { id: "out-1", name: "Speakers", detail: "Realtek(R) Audio", isDefault: true },
  { id: "out-2", name: "Headphones", detail: "WH-1000XM5", isDefault: false },
  { id: "out-3", name: "LG HDR 4K", detail: "NVIDIA High Definition Audio", isDefault: false },
];

export const SAMPLE_APPS: AppVolume[] = [
  { key: "spotify.exe", name: "Spotify", exe: "Spotify.exe", pid: 4120, ids: ["s1"], volume: 100, muted: false, active: true, system: false },
  { key: "chrome.exe", name: "Google Chrome", exe: "chrome.exe", pid: 9876, ids: ["s2", "s3"], volume: 64, muted: false, active: false, system: false },
  { key: "discord.exe", name: "Discord", exe: "Discord.exe", pid: 7731, ids: ["s4"], volume: 80, muted: true, active: false, system: false },
  { key: "system", name: "System sounds", exe: "", pid: 0, ids: ["s5"], volume: 50, muted: false, active: false, system: true },
];
