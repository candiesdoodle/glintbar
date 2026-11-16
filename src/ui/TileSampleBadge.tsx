import { createContext, useContext } from "react";
import { cx } from "./cx";

/** The dock height the current tile is drawn at (TileHost provides it). */
export const TileSizeContext = createContext(44);
export const useTileSize = (): number => useContext(TileSizeContext);

/**
 * The Sample marker sized for dock tiles. On tiles under 64 px it is a small dot in the corner
 * (hover for its meaning) so it never covers the numbers; on bigger tiles a small "Sample" tag.
 * `SampleBadge` is for cards and larger surfaces. This is the only sample marker tiles use, so
 * every account tile reads the same; the tile's root must be `relative` (TileFrame is).
 */
export function TileSampleBadge({ size, corner = "top-right", className }: { size?: number; corner?: "top-right" | "bottom-left"; className?: string }) {
  const ctx = useTileSize();
  size ??= ctx;
  const place = corner === "top-right" ? "top-[3px] right-[3px]" : "bottom-[3px] left-[3px]";
  if (size < 64) {
    return (
      <span
        className={cx("absolute z-[1] block rounded-full bg-warn ring-2 ring-black/20", place, className)}
        style={{ width: 6, height: 6 }}
        title="Sample data"
        aria-label="Sample data"
      />
    );
  }
  return (
    <span
      className={cx("pointer-events-none absolute z-[1] rounded-[4px] bg-warn/25 font-bold tracking-wide text-warn uppercase backdrop-blur-sm", place, className)}
      style={{ fontSize: 8, lineHeight: "11px", padding: "0 3px" }}
      title="Sample data"
    >
      Sample
    </span>
  );
}
