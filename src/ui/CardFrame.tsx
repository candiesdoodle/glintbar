import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

/** The inside of a widget card: header (icon, title, subtitle, actions), body, optional footer. */
export function CardFrame({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        {Icon && (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <Icon size={15} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-fg">{title}</div>
          {subtitle && <div className="line-clamp-2 text-[11.5px] leading-snug text-dim">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3.5">{children}</div>
      {footer && <div className="flex items-center gap-2 border-t border-card-line px-4 py-2.5">{footer}</div>}
    </div>
  );
}

/** A rounded group inside cards and settings. */
export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-3", className)}>
      {title && <h3 className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">{title}</h3>}
      <div className="rounded-xl bg-input px-3.5">{children}</div>
    </section>
  );
}
