import { useState } from "react";
import { HeadphoneOff, Headphones, Mic, MicOff } from "lucide-react";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { Button, CardFrame, cx, EmptyState, Section, SettingRow, TileFrame, TileNotice, Toggle } from "../../../ui";
import { TileSampleBadge } from "../../../ui/TileSampleBadge";
import { FillSlider } from "../../../ui/FillSlider";
import { TileButton, useAudio } from "../shared";
import { openSoundSettings, setMuted, setVolume, useOptimistic } from "../volume";

/** Mute state that flips at once on click and settles when Windows confirms. */
function useMuteToggle(remote: boolean | undefined, input: boolean, isSample: boolean): [boolean, () => void] {
  const [local, setLocal] = useState<boolean | null>(null);
  const value = local ?? Boolean(remote);
  const toggle = () => {
    const next = !value;
    setLocal(next);
    if (isSample) return;
    setMuted(next, input)
      .catch((e) => console.warn("mute failed", e))
      .finally(() => setTimeout(() => setLocal(null), 500));
  };
  return [value, toggle];
}

function MicrophoneTile({ size, isSample }: TileProps) {
  const audio = useAudio(isSample);
  const [micMuted, toggleMic] = useMuteToggle(audio?.input?.muted, true, isSample);
  const [soundMuted, toggleSound] = useMuteToggle(audio?.output?.muted, false, isSample);
  const btn = Math.round(size * 0.7);
  const icon = Math.round(btn * 0.46);
  const hasMic = Boolean(audio?.input);
  const hasOut = Boolean(audio?.output);
  if (audio && !hasMic && !hasOut) return <TileNotice icon={MicOff} title="No audio" detail="No devices" size={size} narrow hint="Windows reports no microphone and no speakers" />;
  return (
    <TileFrame className="justify-center gap-[calc(var(--tile-h)*0.16)]" title="System-wide mute for your mic and your speakers">
      <TileButton
        label={!hasMic ? "No microphone connected" : micMuted ? "Unmute microphone" : "Mute microphone"}
        disabled={!hasMic}
        onPress={toggleMic}
        className={cx(micMuted ? "bg-bad text-white hover:bg-bad" : "bg-track hover:bg-hover")}
        style={{ width: btn, height: btn }}
      >
        {micMuted ? <MicOff size={icon} /> : <Mic size={icon} />}
      </TileButton>
      <TileButton
        label={!hasOut ? "No output device" : soundMuted ? "Unmute sound" : "Mute sound"}
        disabled={!hasOut}
        onPress={toggleSound}
        className={cx(soundMuted ? "bg-bad text-white hover:bg-bad" : "bg-track hover:bg-hover")}
        style={{ width: btn, height: btn }}
      >
        {soundMuted ? <HeadphoneOff size={icon} /> : <Headphones size={icon} />}
      </TileButton>
      {isSample && <TileSampleBadge size={size} />}
    </TileFrame>
  );
}

function MicrophoneCard({ isSample }: CardProps) {
  const audio = useAudio(isSample);
  const input = audio?.input ?? null;
  const [micMuted, toggleMic] = useMuteToggle(audio?.input?.muted, true, isSample);
  const [soundMuted, toggleSound] = useMuteToggle(audio?.output?.muted, false, isSample);
  const [level, change] = useOptimistic(input?.volume, (v) => {
    if (!isSample) setVolume(v, true);
  });
  const vol = Math.round(level ?? 0);
  return (
    <CardFrame
      title="Microphone"
      subtitle={input ? [input.name, input.detail].filter(Boolean).join(" · ") : audio === undefined ? "…" : "No microphone"}
      icon={Mic}
      footer={
        <>
          <span className="flex-1 text-[11px] text-faint">Works system-wide, including in calls.</span>
          <Button size="sm" onClick={() => openSoundSettings("sound")}>
            Sound settings
          </Button>
        </>
      }
    >
      {input ? (
        <div className="mb-3">
          <FillSlider label="Microphone level" value={vol} height={44} icon={micMuted ? <MicOff size={18} /> : <Mic size={18} />} trailing={micMuted ? "Muted" : `${vol}%`} color={micMuted ? "var(--g-faint)" : "var(--g-accent)"} onChange={change} />
        </div>
      ) : (
        audio !== undefined && <EmptyState icon={MicOff} title="No microphone" message="Windows sees no input device. Connect a microphone, or enable it in Sound settings." />
      )}
      <Section className="mb-0">
        <SettingRow label="Mute microphone" description="Your mic goes silent in every app.">
          <Toggle checked={micMuted} onChange={toggleMic} disabled={!input} label="Mute microphone" />
        </SettingRow>
        <SettingRow label="Mute sound" description={audio?.output ? `Turns off audio from ${audio.output.name}.` : "Turns off the speakers."}>
          <Toggle checked={soundMuted} onChange={toggleSound} disabled={!audio?.output} label="Mute sound" />
        </SettingRow>
      </Section>
    </CardFrame>
  );
}

export default defineWidget({
  id: "media.microphone",
  name: "Microphone",
  category: "Media & Audio",
  description: "System-wide mute buttons for your mic and your speakers.",
  keywords: ["mic", "mute", "deafen", "call", "meeting", "headphones", "sound"],
  icon: Mic,
  size: "m",
  Tile: MicrophoneTile,
  Card: MicrophoneCard,
  cardSize: { width: 310 },
});
