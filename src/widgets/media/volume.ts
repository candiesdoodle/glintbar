/** Volume helpers shared by the Audio Output and Microphone widgets. */
import { useEffect, useRef, useState } from "react";
import { Headphones, Monitor, Speaker, Volume1, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { call } from "../../core/backend";

export function volumeIcon(volume: number, muted: boolean): LucideIcon {
  if (muted || volume <= 0) return VolumeX;
  if (volume < 34) return Volume1;
  return Volume2;
}

/** A glyph for the kind of output device, guessed from its name. */
export function deviceIcon(name: string, detail = ""): LucideIcon {
  const s = `${name} ${detail}`;
  if (/head|buds|airpods|earphone|wh-|wf-|hands-free|headset/i.test(s)) return Headphones;
  if (/hdmi|display|monitor|tv|lg |samsung|dell|nvidia high definition/i.test(s)) return Monitor;
  return Speaker;
}

/**
 * A value the user is changing (slider, wheel) that is sent at most every `ms` and shown
 * locally until the backend's own event catches up.
 */
export function useOptimistic(remote: number | undefined, send: (v: number) => void, ms = 60): [number | undefined, (v: number) => void] {
  const [local, setLocal] = useState<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<number | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(
    () => () => {
      clearTimeout(sendTimer.current);
      clearTimeout(clearTimer.current);
    },
    [],
  );
  const set = (v: number) => {
    setLocal(v);
    pending.current = v;
    if (sendTimer.current === undefined) {
      sendTimer.current = setTimeout(() => {
        sendTimer.current = undefined;
        if (pending.current !== null) sendRef.current(pending.current);
      }, ms);
    }
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setLocal(null), 900);
  };
  return [local ?? remote, set];
}

export function setVolume(volume: number, input = false): void {
  call("media", "set_volume", { volume: Math.round(volume), input }).catch((e) => console.warn("set_volume failed", e));
}

export function setMuted(muted: boolean, input = false): Promise<void> {
  return call<void>("media", "set_muted", { muted, input });
}

export function openSoundSettings(page: "sound" | "apps-volume" = "sound"): void {
  call("shell", "open", { target: `ms-settings:${page}` }).catch(() => {});
}
