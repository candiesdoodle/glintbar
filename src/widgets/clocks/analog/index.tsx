import { Clock9 } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { SettingRow, TileFrame, Toggle } from "../../../ui";
import { AnalogFace } from "../AnalogFace";
import { clockCardSize, ClockShellCard } from "../shared";

type AnalogConfig = { seconds: boolean };

function AnalogTile({ config, size }: TileProps<AnalogConfig>) {
  // Once a minute unless the second hand is on.
  const now = useNow(config.seconds ? "second" : "minute");
  const face = Math.round(size * 0.84);
  return (
    <TileFrame padded={false} className="justify-center" title={now.toLocaleTimeString()}>
      <AnalogFace
        hour={now.getHours()}
        minute={now.getMinutes()}
        second={config.seconds ? now.getSeconds() : undefined}
        size={face}
        face="#0d0e12"
        rim="rgba(255,255,255,0.08)"
        ticks="rgba(255,255,255,0.55)"
        hands="#f4f5f8"
        secondColor="#ff9f0a"
      />
    </TileFrame>
  );
}

function AnalogCard({ config, setConfig, close }: CardProps<AnalogConfig>) {
  return (
    <ClockShellCard
      title="Analog Minimal"
      icon={Clock9}
      close={close}
      settings={
        <SettingRow label="Second hand">
          <Toggle checked={config.seconds} onChange={(seconds) => setConfig({ seconds })} />
        </SettingRow>
      }
    />
  );
}

export default defineWidget<AnalogConfig>({
  id: "clocks.analog",
  name: "Analog Minimal",
  category: "Clocks",
  description: "A plain analog clock with hands and hour marks on a dark dial.",
  keywords: ["analog", "watch", "hands", "face", "minimal", "time"],
  icon: Clock9,
  size: "s",
  Tile: AnalogTile,
  Card: AnalogCard,
  get cardSize() {
    return clockCardSize();
  },
  defaultConfig: { seconds: false },
});
