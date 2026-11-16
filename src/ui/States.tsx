import type { ReactNode } from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { Button } from "./controls";
import { cx } from "./cx";
import { TileFrame } from "./TileFrame";

/**
 * A tile's deliberate "nothing to show" state (no battery, no audio device, nothing playing): an
 * icon with a short title and, on taller tiles, a dimmer detail line. `compact` (square tiles)
 * shows only the icon; the words move to the tooltip. Keep both lines to about 12 characters so
 * they fit a size-m tile at the smallest dock height.
 */
export function TileNotice({
  icon: Icon,
  title,
  detail,
  size,
  compact,
  narrow,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  size: number;
  compact?: boolean;
  /** A size-m tile: below 40 px the words get the whole width (no icon). */
  narrow?: boolean;
  hint?: string;
}) {
  const textOnly = !compact && narrow && size < 40;
  return (
    <TileFrame
      padded={false}
      className={cx("gap-[calc(var(--tile-h)*0.12)] px-[calc(var(--tile-h)*0.16)]", (compact || textOnly) && "justify-center")}
      title={hint ?? (detail ? `${title}: ${detail}` : title)}
    >
      {!textOnly && <Icon size={Math.round(size * (compact ? 0.42 : 0.3))} strokeWidth={2} className="shrink-0 text-dim" />}
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="truncate font-medium text-fg" style={{ fontSize: Math.max(9, Math.round(size * 0.23)) }}>
            {title}
          </div>
          {detail && size >= 34 && (
            <div className="truncate text-dim" style={{ fontSize: Math.max(8, Math.round(size * 0.19)) }}>
              {detail}
            </div>
          )}
        </div>
      )}
    </TileFrame>
  );
}

export function EmptyState({ icon: Icon, title, message, action, className }: { icon?: LucideIcon; title: ReactNode; message?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-1.5 px-4 py-6 text-center", className)}>
      {Icon && <Icon size={22} className="mb-1 text-faint" />}
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {message && <div className="max-w-[260px] text-[12px] leading-snug text-dim">{message}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div className={cx("flex items-start gap-2 rounded-lg bg-bad/10 px-3 py-2.5 text-[12px] text-fg", className)}>
      <AlertCircle size={15} className="mt-px shrink-0 text-bad" />
      <div className="min-w-0 flex-1 leading-snug">{message}</div>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Marks numbers that are not the user's own. */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <span className={cx("pointer-events-none rounded-[5px] bg-warn/20 px-1 py-px text-[8.5px] font-semibold tracking-wide text-warn uppercase", className)}>
      Sample
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-track border-t-accent"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}

/** A grey placeholder bar while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("inline-block animate-pulse rounded bg-track", className)} />;
}
