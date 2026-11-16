import type { CSSProperties } from "react";
import type { ThemeId } from "../core/store";
import { previewDesktopUrl } from "./glass/mockDesktop";
import { textOn } from "./color";

/**
 * A live miniature of a theme: the real theme tokens on a tiny bar with four widgets over a small
 * desktop picture. The glass themes frost/blur it with CSS (the real dock uses the WebGL glass).
 */
export function ThemePreview({ theme, widgetStyle = "frosted", accent, height = 92 }: { theme: ThemeId; widgetStyle?: string; accent?: string; height?: number }) {
  const style: CSSProperties = {
    height,
    backgroundImage: `url("${previewDesktopUrl()}")`,
    backgroundSize: "cover",
    backgroundPosition: "78% 96%",
  };
  if (accent) {
    (style as Record<string, string>)["--g-accent"] = accent;
    (style as Record<string, string>)["--g-on-accent"] = textOn(accent);
  }
  const chip = "g-tile flex h-full items-center rounded-[7px] border border-line bg-tile";
  return (
    <div data-theme={theme} data-widget-style={widgetStyle} className="relative overflow-hidden" style={style}>
      <div
        className="g-bar absolute inset-x-[14px] bottom-[10px] flex h-[34px] items-center gap-[4px] rounded-[12px] p-[4px]"
        style={{ "--g-radius-tile": "7px" } as CSSProperties}
      >
        <div className={chip + " w-[54px] flex-col items-start justify-center px-[6px] leading-none"}>
          <span className="text-[11px] font-semibold tabular-nums text-fg">9:41</span>
          <span className="mt-[2px] text-[7.5px] text-dim">Tue 16</span>
        </div>
        <div className={chip + " w-[26px] justify-center"}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--g-track)" strokeWidth="2.2" />
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--g-accent)" strokeWidth="2.2" strokeDasharray="37.7" strokeDashoffset="15" strokeLinecap="round" transform="rotate(-90 8 8)" />
          </svg>
        </div>
        <div className={chip + " w-[58px] gap-[5px] px-[4px]"}>
          <span className="h-[18px] w-[18px] shrink-0 rounded-[4px] bg-[linear-gradient(135deg,#ff8a5c,#a855f7)]" />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="h-[3px] w-[85%] rounded-full bg-fg/80" />
            <span className="h-[3px] w-[55%] rounded-full bg-dim/70" />
          </span>
        </div>
        <div className={chip + " w-[26px] items-end justify-center gap-[2px] pb-[6px]"}>
          {[6, 10, 7, 13].map((h, i) => (
            <span key={i} className="w-[2.5px] rounded-full bg-accent" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
}
