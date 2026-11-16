import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GalleryVerticalEnd } from "lucide-react";
import { useIsVisible, useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import "../clocks.css";
import { clockCardSize, ClockShellCard, FormatRow, useHour24, type HourFormat } from "../shared";

type FlipConfig = { format: HourFormat };

/** One split-flap card. When `value` changes the old top half falls and the new bottom half lands. */
function FlipDigit({ value, width, height, fontSize }: { value: string; width: number; height: number; fontSize: number }) {
  const visible = useIsVisible();
  const [shown, setShown] = useState(value);
  const [prev, setPrev] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (value === shown) return;
    clearTimeout(timer.current);
    if (!visible) {
      // Off-screen: no animation, just show the new digit.
      setPrev(null);
      setShown(value);
      return;
    }
    setPrev(shown);
    setShown(value);
    timer.current = setTimeout(() => setPrev(null), 520);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const style = { width, height, fontSize, borderRadius: Math.max(3, Math.round(width * 0.18)), ["--glintbar-flip-bg" as string]: "var(--g-input)" } as CSSProperties;
  const half = (cls: string, v: string, extra = "") => (
    <div className={`glintbar-flip-half ${cls} ${extra}`}>
      <span>{v}</span>
    </div>
  );
  return (
    <div className="glintbar-flip font-semibold tabular-nums text-fg" style={style} aria-hidden>
      {/* Static halves: the new top, and the old bottom until the flap lands on it. */}
      {half("glintbar-flip-top", shown)}
      {half("glintbar-flip-bottom", prev ?? shown)}
      {prev !== null && (
        <>
          {half("glintbar-flip-top", prev, "glintbar-flip-anim-top")}
          {half("glintbar-flip-bottom", shown, "glintbar-flip-anim-bottom")}
        </>
      )}
      <div className="glintbar-flip-hinge" />
    </div>
  );
}

function FlipTile({ config, size }: TileProps<FlipConfig>) {
  const hour24 = useHour24(config.format);
  const now = useNow("minute");
  const h = now.getHours();
  const hh = hour24 ? String(h).padStart(2, "0") : String(h % 12 || 12).padStart(2, " ");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const dh = Math.round(size * 0.7);
  const dw = Math.round(dh * 0.56);
  const fs = Math.round(dh * 0.66);
  const digit = (v: string, k: string) => <FlipDigit key={k} value={v === " " ? "" : v} width={dw} height={dh} fontSize={fs} />;
  return (
    <TileFrame className="justify-center gap-[2px] px-[calc(var(--tile-h)*0.1)]" title={now.toLocaleTimeString()}>
      {digit(hh[0], "h0")}
      {digit(hh[1], "h1")}
      <span className="mx-[1px] flex flex-col gap-[3px]" style={{ gap: Math.round(size * 0.12) }} aria-hidden>
        <span className="block rounded-full bg-dim" style={{ width: Math.max(2, size * 0.06), height: Math.max(2, size * 0.06) }} />
        <span className="block rounded-full bg-dim" style={{ width: Math.max(2, size * 0.06), height: Math.max(2, size * 0.06) }} />
      </span>
      {digit(mm[0], "m0")}
      {digit(mm[1], "m1")}
      {!hour24 && size >= 40 && (
        <span className="ml-[2px] self-end pb-[calc(var(--tile-h)*0.16)] text-dim" style={{ fontSize: Math.round(size * 0.18) }}>
          {h >= 12 ? "PM" : "AM"}
        </span>
      )}
    </TileFrame>
  );
}

function FlipCard({ config, setConfig, close }: CardProps<FlipConfig>) {
  return <ClockShellCard title="Flip Clock" icon={GalleryVerticalEnd} close={close} settings={<FormatRow value={config.format} onChange={(format) => setConfig({ format })} />} />;
}

export default defineWidget<FlipConfig>({
  id: "clocks.flip",
  name: "Flip Clock",
  category: "Clocks",
  description: "A flip clock whose digit cards fold down when the minute changes.",
  keywords: ["time", "flip", "split-flap", "retro", "digits"],
  icon: GalleryVerticalEnd,
  size: "m",
  Tile: FlipTile,
  Card: FlipCard,
  get cardSize() {
    return clockCardSize();
  },
  defaultConfig: { format: "auto" },
});
