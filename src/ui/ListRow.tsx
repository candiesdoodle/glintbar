import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export function ListRow({ icon: Icon, leading, title, subtitle, right, onClick, className }: { icon?: LucideIcon; leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; onClick?: () => void; className?: string }) {
  const body = (
    <>
      {leading ?? (Icon && <Icon size={16} className="shrink-0 text-dim" />)}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] text-fg">{title}</div>
        {subtitle && <div className="truncate text-[11.5px] text-dim">{subtitle}</div>}
      </div>
      {right !== undefined && <div className="shrink-0 text-[12px] text-dim tabular-nums">{right}</div>}
    </>
  );
  const cls = cx("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5", onClick && "hover:bg-hover", className);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
