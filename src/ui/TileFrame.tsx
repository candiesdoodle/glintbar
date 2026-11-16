import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

/**
 * The standard tile surface: theme background, border, radius, padding. The dock adds hover,
 * press and click handling around it, so tiles don't need their own click handler.
 */
export function TileFrame({
  children,
  className,
  style,
  padded = true,
  title,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padded?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className={cx(
        "g-tile relative flex h-full w-full items-center overflow-hidden rounded-tile border border-line bg-tile text-fg",
        padded && "px-[calc(var(--tile-h)*0.2)]",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
