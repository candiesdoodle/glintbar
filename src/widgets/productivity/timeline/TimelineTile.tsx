import { Sunrise, Sunset } from "lucide-react";
import { duration, timeOfDay } from "../../../core/format";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { startOfDay } from "../shared/time";
import { useDayLine, type TimelineConfig } from "./data";
import { Track } from "./Track";

export function TimelineTile({ config, size, isSample }: TileProps<TimelineConfig>) {
  const now = useNow("minute").getTime();
  const hour24 = useSettings((s) => s.clock24h);
  const line = useDayLine(config, isSample, now);
  const small = Math.max(9, Math.round(size * 0.22));
  const icon = Math.max(10, Math.round(size * 0.24));
  return (
    <TileFrame className="flex-col items-stretch justify-center gap-[calc(var(--tile-h)*0.1)]" title="Day Timeline">
      {isSample && <TileSampleBadge />}
      <div className="flex items-center gap-2 leading-none text-dim" style={{ fontSize: small }}>
        <span className="font-semibold text-fg tabular-nums">{line.loaded ? duration(line.totalSecs) : "–"}</span>
        {line.focus.length > 0 && <span className="truncate">· {line.focus.length} focus</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
          {line.sunrise && (
            <>
              <Sunrise size={icon} className="text-warn" /> {timeOfDay(new Date(line.sunrise), { hour24 })}
            </>
          )}
          {line.sunset && size >= 40 && (
            <>
              <Sunset size={icon} className="ml-1 text-warn" /> {timeOfDay(new Date(line.sunset), { hour24 })}
            </>
          )}
        </span>
      </div>
      <Track line={line} dayStart={startOfDay(now)} now={now} height={Math.round(size * 0.36)} />
    </TileFrame>
  );
}
