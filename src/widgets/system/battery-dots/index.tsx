import { Grip } from "lucide-react";
import { defineWidget, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { BatteryCard, Corner, LoadingTile, NoBatteryTile, batteryTitle, useBatteryView } from "../shared/battery";
import { batteryColor } from "../shared/format";

/** 3 x 5 dot font. */
const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "%": ["101", "001", "010", "100", "101"],
  "-": ["000", "000", "111", "000", "000"],
};

const COLS = 11; // "100" = 3 glyphs x 3 + 2 gaps
const ROWS = 7; // 5 for the number, a gap, one for the charge

function DotMatrix({ text, percent, color, pitch }: { text: string; percent: number; color: string; pitch: number }) {
  const chars = text.split("");
  const width = chars.length * 4 - 1;
  const offset = Math.floor((COLS - width) / 2);
  const on = new Set<string>();
  chars.forEach((ch, i) => {
    const g = GLYPHS[ch] ?? GLYPHS["-"];
    g.forEach((row, y) => row.split("").forEach((bit, x) => bit === "1" && on.add(`${offset + i * 4 + x},${y}`)));
  });
  const lit = Math.round((Math.max(0, Math.min(100, percent)) / 100) * COLS);
  const r = pitch * 0.4;
  const dots = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < COLS; x++) {
      const isOn = on.has(`${x},${y}`);
      dots.push(<circle key={`${x}-${y}`} cx={x * pitch + pitch / 2} cy={y * pitch + pitch / 2} r={r} fill={isOn ? "var(--g-fg)" : "var(--g-track)"} fillOpacity={isOn ? 1 : 0.4} />);
    }
  for (let x = 0; x < COLS; x++)
    dots.push(<circle key={`c${x}`} cx={x * pitch + pitch / 2} cy={6 * pitch + pitch / 2} r={r} fill={x < lit ? color : "var(--g-track)"} style={{ transition: "fill 400ms ease" }} />);
  return (
    <svg width={COLS * pitch} height={ROWS * pitch} viewBox={`0 0 ${COLS * pitch} ${ROWS * pitch}`} aria-hidden>
      {dots}
    </svg>
  );
}

function DotsTile({ size, isSample }: TileProps) {
  const { b, sample } = useBatteryView(isSample);
  if (!b) return <LoadingTile size={size} />;
  if (!b.present) return <NoBatteryTile size={size} />;
  const pct = b.percent ?? 0;
  const color = batteryColor(b.percent, b.charging);
  const tileW = 2 * size + 6;
  const pitch = Math.min((size * 0.8) / ROWS, (tileW - size * 0.3) / COLS);
  return (
    <TileFrame className="justify-center" title={batteryTitle(b)}>
      <DotMatrix text={b.percent === null ? "--" : String(pct)} percent={pct} color={color} pitch={pitch} />
      <Corner sample={sample} />
    </TileFrame>
  );
}

export default defineWidget({
  id: "system.battery-dots",
  name: "Battery Dots",
  category: "System",
  description: "Battery percentage in dot digits over a dotted level bar.",
  keywords: ["power", "charge", "laptop", "charging", "dot matrix", "pixel"],
  icon: Grip,
  size: "m",
  Tile: DotsTile,
  Card: BatteryCard,
  cardSize: { width: 320 },
});
