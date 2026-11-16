/** Browser-preview data for the media slice. Loaded only when there is no Tauri backend. */
import { mockEmit, mockService, mockTopic } from "../../core/mock";
import { nowPlayingFrom, SAMPLE_APPS, SAMPLE_AUDIO, SAMPLE_OUTPUTS, SAMPLE_TRACKS } from "./samples";
import type { AppVolume, AudioDevice, AudioState, MediaAction, NowPlaying } from "./types";

// ---- now playing: a little playlist that really plays (position, track ends, skip) ----------

let index = 0;
let playing = true;
let positionMs = 81_000;
let startedAt = Date.now();
let endTimer: ReturnType<typeof setTimeout> | undefined;
let listeners = 0;

function currentPos(): number {
  return playing ? Math.min(SAMPLE_TRACKS[index].durationMs, positionMs + (Date.now() - startedAt)) : positionMs;
}

function snapshot(): NowPlaying {
  return nowPlayingFrom(SAMPLE_TRACKS[index], currentPos(), playing);
}

function emit() {
  mockEmit("media", "now_playing", snapshot());
  schedule();
}

function schedule() {
  clearTimeout(endTimer);
  if (!playing || listeners === 0) return;
  const left = SAMPLE_TRACKS[index].durationMs - currentPos();
  endTimer = setTimeout(() => skip(1), Math.max(250, left));
}

function setPos(ms: number) {
  positionMs = Math.max(0, ms);
  startedAt = Date.now();
}

function skip(dir: 1 | -1) {
  if (dir === -1 && currentPos() > 3000) setPos(0);
  else {
    index = (index + dir + SAMPLE_TRACKS.length) % SAMPLE_TRACKS.length;
    setPos(0);
  }
  emit();
}

mockTopic<NowPlaying>("media", "now_playing", {
  start: (send) => {
    listeners++;
    send(snapshot());
    schedule();
    return () => {
      listeners--;
      if (listeners === 0) clearTimeout(endTimer);
    };
  },
});

// ---- audio --------------------------------------------------------------------------------

const audio: AudioState = structuredClone(SAMPLE_AUDIO);
let outputs: AudioDevice[] = structuredClone(SAMPLE_OUTPUTS);
const apps: AppVolume[] = structuredClone(SAMPLE_APPS);

const emitAudio = () => mockEmit("media", "audio", structuredClone(audio));

mockTopic<AudioState>("media", "audio", {
  start: (send) => {
    send(structuredClone(audio));
  },
});

mockService("media", {
  now_playing_get: () => snapshot(),
  control: ({ action, positionMs: to }: { action: MediaAction; positionMs?: number; appId?: string }) => {
    if (action === "play_pause" || action === "play" || action === "pause") {
      const next = action === "play" ? true : action === "pause" ? false : !playing;
      setPos(currentPos());
      playing = next;
    } else if (action === "next") skip(1);
    else if (action === "previous") skip(-1);
    else if (action === "seek" && typeof to === "number") setPos(to);
    emit();
    return true;
  },
  audio_get: () => audio,
  set_volume: ({ volume, input }: { volume: number; input?: boolean }) => {
    const ep = input ? audio.input : audio.output;
    if (!ep) throw "not_found: no sound device is available";
    ep.volume = Math.round(Math.max(0, Math.min(100, volume)));
    if (ep.volume > 0) ep.muted = false;
    emitAudio();
  },
  set_muted: ({ muted, input }: { muted: boolean; input?: boolean }) => {
    const ep = input ? audio.input : audio.output;
    if (!ep) throw "not_found: no sound device is available";
    ep.muted = muted;
    emitAudio();
  },
  outputs: () => outputs,
  set_output: ({ id }: { id: string }) => {
    const dev = outputs.find((d) => d.id === id);
    if (!dev) throw "not_found: that output device was removed";
    outputs = outputs.map((d) => ({ ...d, isDefault: d.id === id }));
    audio.output = { id: dev.id, name: dev.name, detail: dev.detail, volume: dev.id === "out-2" ? 30 : 42, muted: false };
    emitAudio();
  },
  apps: () => apps,
  set_app_volume: ({ ids, volume, muted }: { ids: string[]; volume?: number; muted?: boolean }) => {
    const app = apps.find((a) => a.ids.some((i) => ids.includes(i)));
    if (!app) throw "not_found: that app has stopped playing audio";
    if (typeof volume === "number") {
      app.volume = Math.round(volume);
      if (volume > 0 && muted === undefined) app.muted = false;
    }
    if (typeof muted === "boolean") app.muted = muted;
  },
});
