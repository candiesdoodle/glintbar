/** Building blocks of the Settings pages: grouped rows with hairline separators and info tips. */
import { Children, Fragment, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info, type LucideIcon } from "lucide-react";
import { Slider } from "../ui/controls";
import { cx } from "../ui/cx";

/** A titled group of rows (inset, rounded, hairline separators). */
export function Group({ title, footer, children, className }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <section className={cx("mb-5", className)}>
      {title && <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-dim">{title}</h3>}
      <div className="overflow-hidden rounded-[12px] border border-card-line bg-input">
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <div className="mx-3.5 h-px bg-[var(--g-card-line)]" />}
            {row}
          </Fragment>
        ))}
      </div>
      {footer && <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-faint">{footer}</p>}
    </section>
  );
}

/** One setting: label (+ info tip, + description) on the left, the control on the right. */
export function Row({
  label,
  info,
  description,
  children,
  disabled,
  stacked,
}: {
  label: ReactNode;
  info?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  /** Put the control under the label (wide controls such as sliders). */
  stacked?: boolean;
}) {
  return (
    <div className={cx("px-3.5 py-2.5", stacked ? "flex flex-col gap-2" : "flex min-h-[44px] items-center justify-between gap-4", disabled && "opacity-45")}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] text-fg">
          <span>{label}</span>
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        {description && <div className="mt-0.5 text-[11.5px] leading-snug text-dim">{description}</div>}
      </div>
      {children !== undefined && <div className={cx(stacked ? "w-full" : "shrink-0", disabled && "pointer-events-none")}>{children}</div>}
    </div>
  );
}

/** A slider row with its value. */
export function RangeRow({
  label,
  info,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  format,
  onChange,
  disabled,
}: {
  label: ReactNode;
  info?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cx("flex min-h-[44px] items-center gap-4 px-3.5 py-2", disabled && "pointer-events-none opacity-45")}>
      <div className="flex w-[172px] shrink-0 items-center gap-1.5 text-[13px] text-fg">
        <span>{label}</span>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={typeof label === "string" ? label : undefined} />
      <div className="min-w-12 shrink-0 text-right text-[12px] whitespace-nowrap text-dim tabular-nums">{format ? format(value) : `${value}${unit}`}</div>
    </div>
  );
}

/** A small (i) that explains a setting on hover or focus. */
export function InfoTip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 110;
    setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="More about this setting"
        className="grid h-4 w-4 place-items-center rounded-full text-faint transition-colors hover:text-fg"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
      >
        <Info size={13} strokeWidth={2.2} />
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            data-glintbar-panel="tip"
            className="g-panel pointer-events-none fixed z-[60] w-max max-w-[260px] rounded-[10px] px-3 py-2 text-[11.5px] leading-snug text-fg"
            style={{
              left: Math.max(140, Math.min(pos.x, window.innerWidth - 140)),
              top: pos.y,
              transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)",
              borderRadius: 10,
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A coloured rounded-square icon, like system settings. */
export function IconTile({ icon: Icon, colour, size = 22 }: { icon: LucideIcon; colour: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[6px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={{ width: size, height: size, background: colour }}>
      <Icon size={Math.round(size * 0.62)} strokeWidth={2.2} />
    </span>
  );
}

/** Choice cards (used for widget style, icon size): a row of selectable boxes. */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; preview: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="g-press flex flex-col items-center gap-1.5"
          aria-pressed={o.value === value}
        >
          <span className={cx("block overflow-hidden rounded-[10px] ring-2 ring-offset-0 transition-shadow", o.value === value ? "ring-accent" : "ring-transparent")}>{o.preview}</span>
          <span className={cx("text-[11.5px]", o.value === value ? "font-medium text-fg" : "text-dim")}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
