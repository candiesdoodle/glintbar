import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TileFrame, cx } from "../../../ui";
import { useTileAction } from "./hooks";

/** A square one-click tile (theme, do not disturb, notifications, show desktop, keyboard). */
export function ActionTile({
  size,
  isSample,
  icon: Icon,
  title,
  active = false,
  busy = false,
  onAction,
  children,
}: {
  size: number;
  isSample: boolean;
  icon: LucideIcon;
  title: string;
  active?: boolean;
  busy?: boolean;
  onAction: () => void;
  children?: ReactNode;
}) {
  const act = useTileAction(isSample, onAction);
  return (
    <div className="h-full w-full" role="button" aria-label={title} aria-pressed={active} {...act}>
      <TileFrame padded={false} className="justify-center" title={title}>
        <div className={cx("absolute inset-0 transition-opacity duration-300", active ? "bg-accent/20 opacity-100" : "opacity-0")} />
        <Icon
          size={Math.round(size * 0.42)}
          strokeWidth={2}
          className={cx("relative transition-[color,transform,opacity] duration-300", active ? "text-accent" : "text-fg", busy && "opacity-50")}
        />
        {children}
      </TileFrame>
    </div>
  );
}
