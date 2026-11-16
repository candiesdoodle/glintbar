import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import "./motion.css";
import type { LucideIcon } from "lucide-react";
import { clamp, cx } from "./cx";

export function ProgressBar({ value, max = 100, color = "var(--g-accent)", height = 6, className }: { value: number; max?: number; color?: string; height?: number; className?: string }) {
  const pct = max > 0 ? clamp(value / max, 0, 1) * 100 : 0;
  return (
    <div className={cx("w-full overflow-hidden rounded-full bg-track", className)} style={{ height }}>
      <div className="g-glide h-full rounded-full" style={{ width: `${pct}%`, background: color, "--g-glide": "width 500ms" } as CSSProperties} />
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="truncate text-[11px] text-dim">{label}</div>
      <div className="truncate text-[17px] font-semibold tabular-nums text-fg">{value}</div>
      {sub !== undefined && <div className="truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        checked ? "bg-accent" : "bg-track",
      )}
    >
      <span
        className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, className, label }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; className?: string; label?: string }) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      className={cx("g-slider w-full", className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--fill" as string]: `${pct}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-lg bg-input p-0.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-2.5 py-1 text-[12px] transition-colors",
            o.value === value ? "bg-accent text-on-accent shadow-sm" : "text-dim hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", size = "md", icon: Icon, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "g-press inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-accent text-on-accent hover:brightness-110",
        variant === "secondary" && "bg-input text-fg hover:bg-hover",
        variant === "ghost" && "text-dim hover:bg-hover hover:text-fg",
        variant === "danger" && "bg-bad/15 text-bad hover:bg-bad/25",
        className,
      )}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 15} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, size = 16, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: number }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx("g-press grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-fg", className)}>
      <Icon size={size} />
    </button>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        "h-8 w-full rounded-lg border border-card-line bg-input px-2.5 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent",
        className,
      )}
    />
  );
}

/** A labelled settings row: label + optional description on the left, control on the right. */
export function SettingRow({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[11.5px] leading-snug text-dim">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
