import { shortDate, timeParts } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { useClockPrefs, type ClockConfig } from "./config";

export function ClockTile({ config, size }: TileProps<ClockConfig>) {
  const { hour24, seconds } = useClockPrefs(config);
  // Re-renders once a second only when seconds are shown, and never while off-screen.
  const now = useNow(seconds ? "second" : "minute");
  const t = timeParts(now, hour24);
  const big = Math.round(size * (config.showDate ? 0.4 : 0.5));
  const small = Math.max(9, Math.round(size * 0.24));
  return (
    <TileFrame className="flex-col justify-center leading-none" title={now.toLocaleString()}>
      <div className="flex items-baseline gap-[2px] font-semibold tabular-nums">
        <span style={{ fontSize: big }}>{t.main}</span>
        {seconds && (
          <span className="text-dim" style={{ fontSize: Math.round(big * 0.62) }}>
            :{t.seconds}
          </span>
        )}
        {t.period && (
          <span className="ml-0.5 text-dim" style={{ fontSize: Math.round(big * 0.5) }}>
            {t.period}
          </span>
        )}
      </div>
      {config.showDate && (
        <div className="mt-[3px] truncate text-dim" style={{ fontSize: small }}>
          {shortDate(now)}
        </div>
      )}
    </TileFrame>
  );
}
