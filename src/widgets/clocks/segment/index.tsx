import { Binary } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { SettingRow, TileFrame, Toggle } from "../../../ui";
import { clockCardSize, ClockShellCard, FormatRow, useHour24, type HourFormat } from "../shared";

type SegmentConfig = { format: HourFormat; seconds: boolean };

// Segments a-g of a 10 x 18 digit cell (slanted slightly by the parent transform).
const SEGMENTS: Record<string, string> = {
  a: "M2 1 H8 L7 2.4 H3 Z",
  b: "M8.6 1.6 V8.2 L7.4 7.4 V3 Z",
  c: "M8.6 9.8 V16.4 L7.4 15 V10.6 Z",
  d: "M2 17 H8 L7 15.6 H3 Z",
  e: "M1.4 9.8 V16.4 L2.6 15 V10.6 Z",
  f: "M1.4 1.6 V8.2 L2.6 7.4 V3 Z",
  g: "M2 9 L3 8.2 H7 L8 9 L7 9.8 H3 Z",
};
const DIGITS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  " ": "",
};

function Digit({ ch, height }: { ch: string; height: number }) {
  const on = DIGITS[ch] ?? "";
  return (
    <svg viewBox="0 0 10 18" width={(height * 10) / 18} height={height} className="shrink-0" style={{ transform: "skewX(-6deg)" }} aria-hidden>
      {Object.entries(SEGMENTS).map(([k, d]) => (
        <path key={k} d={d} fill={on.includes(k) ? "var(--g-accent)" : "var(--g-track)"} style={on.includes(k) ? { filter: "drop-shadow(0 0 2px color-mix(in srgb, var(--g-accent) 55%, transparent))" } : undefined} />
      ))}
    </svg>
  );
}

function Colon({ height }: { height: number }) {
  const dot = Math.max(2, Math.round(height * 0.11));
  return (
    <span className="flex shrink-0 flex-col justify-center" style={{ gap: Math.round(height * 0.26), height, width: dot + 2 }} aria-hidden>
      <span className="block rounded-full bg-accent" style={{ width: dot, height: dot }} />
      <span className="block rounded-full bg-accent" style={{ width: dot, height: dot }} />
    </span>
  );
}

function SegmentTile({ config, size }: TileProps<SegmentConfig>) {
  const hour24 = useHour24(config.format);
  const now = useNow(config.seconds ? "second" : "minute");
  const h = now.getHours();
  const hh = hour24 ? String(h).padStart(2, "0") : String(h % 12 || 12).padStart(2, " ");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dh = Math.round(size * 0.5);
  const gap = Math.max(1, Math.round(size * 0.04));
  return (
    <TileFrame className="flex-col justify-center gap-[calc(var(--tile-h)*0.06)] leading-none" title={now.toLocaleString()}>
      <div className="w-full truncate text-center text-dim uppercase" style={{ fontSize: Math.max(8, Math.round(size * 0.18)), letterSpacing: "0.08em" }}>
        {now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
      </div>
      <div className="flex items-center" style={{ gap }}>
        <Digit ch={hh[0]} height={dh} />
        <Digit ch={hh[1]} height={dh} />
        <Colon height={dh} />
        <Digit ch={mm[0]} height={dh} />
        <Digit ch={mm[1]} height={dh} />
        {config.seconds && (
          <>
            <Colon height={dh} />
            <Digit ch={ss[0]} height={dh} />
            <Digit ch={ss[1]} height={dh} />
          </>
        )}
        {!hour24 && (
          <span className="ml-[2px] self-end font-semibold text-accent" style={{ fontSize: Math.max(7, Math.round(size * 0.15)) }}>
            {h >= 12 ? "PM" : "AM"}
          </span>
        )}
      </div>
    </TileFrame>
  );
}

function SegmentCard({ config, setConfig, close }: CardProps<SegmentConfig>) {
  return (
    <ClockShellCard
      title="Segment Clock"
      icon={Binary}
      close={close}
      settings={
        <>
          <FormatRow value={config.format} onChange={(format) => setConfig({ format })} />
          <SettingRow label="Seconds">
            <Toggle checked={config.seconds} onChange={(seconds) => setConfig({ seconds })} />
          </SettingRow>
        </>
      }
    />
  );
}

export default defineWidget<SegmentConfig>({
  id: "clocks.segment",
  name: "Segment Clock",
  category: "Clocks",
  description: "The time in LCD segment digits, with weekday and date above.",
  keywords: ["digital", "seven segment", "led", "lcd", "retro", "time"],
  icon: Binary,
  size: "l",
  Tile: SegmentTile,
  Card: SegmentCard,
  get cardSize() {
    return clockCardSize();
  },
  defaultConfig: { format: "auto", seconds: false },
});
