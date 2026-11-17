import type { CSSProperties } from "react";
import { cx } from "../../../ui";
import { AppIcon } from "../shared/AppIcon";
import type { DockApp } from "../shared/grouping";
import type { AppStyle, Metrics } from "./config";

/** The Start button's mark: four rounded tiles in the accent colour. */
export function StartMark({ size }: { size: number }) {
  const s = size;
  const g = s * 0.08;
  const t = (s - g) / 2;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden>
      <defs>
        <linearGradient id="glintbar-start" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--g-accent)" }} />
          <stop offset="1" style={{ stopColor: "var(--g-accent)", stopOpacity: 0.62 }} />
        </linearGradient>
      </defs>
      {[0, 1].map((r) =>
        [0, 1].map((c) => <rect key={`${r}${c}`} x={c * (t + g)} y={r * (t + g)} width={t} height={t} rx={t * 0.28} fill="url(#glintbar-start)" />),
      )}
    </svg>
  );
}

function Badge({ value, size }: { value: number; size: number }) {
  const h = Math.max(12, Math.round(size * 0.3));
  if (value === 0) {
    return <span className="absolute rounded-full bg-bad ring-2 ring-[var(--g-bar)]" style={{ top: size * 0.08, right: size * 0.08, width: h * 0.6, height: h * 0.6 }} />;
  }
  return (
    <span
      className="absolute grid place-items-center rounded-full bg-bad px-[3px] font-semibold text-white tabular-nums ring-2 ring-[var(--g-bar)]"
      style={{ top: size * 0.04, right: size * 0.04, minWidth: h, height: h, fontSize: Math.max(8.5, h * 0.62), lineHeight: 1 }}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

function GroupGrid({ app, icon }: { app: DockApp; icon: number }) {
  const items = app.group?.items.slice(0, 4) ?? [];
  const cell = Math.round(icon * 0.42);
  return (
    <span className="grid grid-cols-2 place-items-center gap-[8%] rounded-[24%] bg-input p-[9%]" style={{ width: icon, height: icon }}>
      {items.map((e) => (
        <AppIcon key={e.id} source={e.icon} name={e.name} kind={e.kind} size={cell} />
      ))}
    </span>
  );
}

/** One dock slot: the card or bare icon, its open dot, badge and attention glow. */
export function AppVisual({
  app,
  start,
  m,
  style,
  highlight,
  showActive,
  className,
  css,
}: {
  app?: DockApp;
  start?: boolean;
  m: Metrics;
  style: AppStyle;
  highlight?: boolean;
  /** Give the app whose window is in front an accent-coloured background. */
  showActive?: boolean;
  className?: string;
  css?: CSSProperties;
}) {
  const running = !!app && app.windows.length > 0;
  const lit = !!showActive && !!app?.active;
  const dotW = app?.active ? Math.round(m.height * 0.26) : Math.max(4, Math.round(m.height * 0.09));
  const dotH = Math.max(3, Math.round(m.height * 0.07));
  return (
    <div
      className={cx(
        "relative grid shrink-0 place-items-center",
        style === "cards" && "rounded-tile border transition-colors duration-150",
        style === "cards" && (lit ? "border-accent/60 bg-accent/25" : "border-line bg-tile hover:bg-tile-hover"),
        style === "icons" && "rounded-[10px] transition-colors duration-150",
        style === "icons" && (lit ? "bg-accent/25" : "hover:bg-hover"),
        app?.flashing && "glintbar-apps-flash",
        highlight && "ring-2 ring-accent",
        app?.hung && "opacity-60 grayscale",
        className,
      )}
      style={{ width: m.slot, height: m.height, ...css }}
    >
      <span className="grid place-items-center" style={{ transform: `translateY(${running ? -m.height * 0.035 : 0}px)` }}>
        {start ? (
          <StartMark size={Math.round(m.icon * 0.82)} />
        ) : app?.kind === "group" ? (
          <GroupGrid app={app} icon={m.icon} />
        ) : (
          <AppIcon source={app?.icon} name={app?.name ?? ""} kind={app?.kind} size={m.icon} />
        )}
      </span>
      {running && (
        <span
          className={cx("absolute left-1/2 -translate-x-1/2 rounded-full transition-all duration-200", app.active ? "bg-accent" : "bg-dim")}
          style={{ bottom: Math.max(2, Math.round(m.height * 0.06)), width: dotW, height: dotH }}
        />
      )}
      {app && app.badge !== null && <Badge value={app.badge} size={m.height} />}
    </div>
  );
}
