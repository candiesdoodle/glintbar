import { Clock } from "lucide-react";
import { defineWidget, type CardProps } from "../../../core/widget";
import { Segmented, SettingRow, Toggle } from "../../../ui";
import { clockCardSize, ClockShellCard, findCalendar, FormatRow } from "../shared";
import { ClockCard } from "./ClockCard";
import { ClockTile } from "./ClockTile";
import type { ClockConfig } from "./config";

/** With the Calendar widget installed, a click opens it (this clock's settings fold underneath). */
function ClockOrCalendar(props: CardProps<ClockConfig>) {
  const { config, setConfig, close } = props;
  if (!findCalendar()) return <ClockCard {...props} />;
  return (
    <ClockShellCard
      title="Clock"
      icon={Clock}
      close={close}
      settings={
        <>
          <FormatRow value={config.format} onChange={(format) => setConfig({ format })} />
          <SettingRow label="Seconds">
            <Segmented
              value={config.seconds}
              options={[
                { value: "auto", label: "Auto" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              onChange={(seconds) => setConfig({ seconds })}
            />
          </SettingRow>
          <SettingRow label="Show the date">
            <Toggle checked={config.showDate} onChange={(showDate) => setConfig({ showDate })} />
          </SettingRow>
        </>
      }
    />
  );
}

/**
 * Reference widget (pure frontend): a tile, a card, per-instance config, global settings.
 * Copy this folder to start a new widget.
 */
export default defineWidget<ClockConfig>({
  id: "clocks.clock",
  name: "Clock",
  category: "Clocks",
  description: "Large digital time, optional seconds and date; click for a calendar.",
  keywords: ["time", "date", "calendar", "seconds"],
  icon: Clock,
  size: "m",
  Tile: ClockTile,
  Card: ClockOrCalendar,
  get cardSize() {
    return clockCardSize();
  },
  defaultConfig: { format: "auto", seconds: "auto", showDate: true },
});
