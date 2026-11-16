/**
 * The widget picker: categories on the left (they follow the scroll), search over names,
 * descriptions and keywords, live previews rendered from each widget's sample data, click a
 * widget to add it or remove it. Previews mount only once they scroll into view and pause when
 * they leave it, so the picker opens instantly with 100+ widgets.
 *
 * Installed apps: if the apps slice provides `src/widgets/apps/PickerApps.tsx` exporting
 * `PickerApps({ query }: { query: string })` (a section listing installed apps with add/remove),
 * it is shown under its own "Apps" entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Blocks,
  ChartColumn,
  Check,
  Clock,
  CloudSun,
  Code,
  Cpu,
  LayoutGrid,
  ListTodo,
  Mail,
  Music,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { searchWidgets, useAllWidgets, widgetsByCategory } from "../core/registry";
import { tileWidth, type Category, type WidgetDef, type WidgetSize } from "../core/widget";
import { dockActions, useDock } from "../dock/layout";
import { Popover } from "../dock/Popover";
import { TileHost } from "../dock/TileHost";
import { useDockUi } from "../dock/ui";
import { IconButton } from "../ui/controls";
import { cx } from "../ui/cx";
import { EmptyState } from "../ui/States";
import { useLazyVisible } from "./lazy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWidget = WidgetDef<any>;

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  AI: Sparkles,
  Productivity: ListTodo,
  Finance: Wallet,
  System: Cpu,
  "Media & Audio": Music,
  Analytics: ChartColumn,
  Developer: Code,
  "Online & Mail": Mail,
  Social: Users,
  "Apps & Files": AppWindow,
  Weather: CloudSun,
  Stocks: TrendingUp,
  Clocks: Clock,
};

const SIZE_LABEL: Record<WidgetSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };
const PREVIEW_H = 40;
const PREVIEW_GAP = 6;
const APPS_ID = "__apps";

const appModules = import.meta.glob<{ PickerApps?: ComponentType<{ query: string }> }>("../widgets/apps/PickerApps.tsx", { eager: true });
const PickerApps: ComponentType<{ query: string }> | undefined = Object.values(appModules)[0]?.PickerApps;
const NO_WIDGETS: AnyWidget[] = [];

export function WidgetPicker() {
  // Widgets are code-split; the picker is the one place that needs all of them.
  const loaded = useAllWidgets();
  const widgets = loaded ?? NO_WIDGETS;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>("");
  const [atTop, setAtTop] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const instances = useDock((s) => s.instances);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of instances) m.set(i.widgetId, (m.get(i.widgetId) ?? 0) + 1);
    return m;
  }, [instances]);
  const results = useMemo(() => searchWidgets(query, widgets), [query, widgets]);
  const groups = useMemo(() => widgetsByCategory(results), [results]);
  const allGroups = useMemo(() => widgetsByCategory(widgets), [widgets]);
  const searching = query.trim().length > 0;

  // The sidebar follows the scroll: the last section whose top has passed the top edge.
  const syncActive = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const sections = el.querySelectorAll<HTMLElement>("[data-section]");
    let current = sections[0]?.dataset.section ?? "";
    const top = el.getBoundingClientRect().top + 12;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= top) current = s.dataset.section ?? current;
      else break;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4 && sections.length) current = sections[sections.length - 1].dataset.section ?? current;
    setActive(current);
    setAtTop(el.scrollTop < 8);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          syncActive();
        });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    syncActive();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [syncActive, groups]);

  const jump = (id: string) => {
    if (searching) setQuery("");
    requestAnimationFrame(() => {
      const el = scroller.current;
      const target = el?.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`);
      if (el && target) el.scrollTo({ top: target.offsetTop - 4, behavior: "smooth" });
    });
  };

  const total = widgets.length;
  const onDock = instances.length;

  return (
    <Popover id="panel" anchor="center" width={880} maxHeight={560} className="h-[560px]">
      <div className="flex min-h-0 flex-1">
        <nav className="g-scroll-y flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-card-line bg-[color-mix(in_srgb,var(--g-input)_60%,transparent)] p-2.5" aria-label="Widget categories">
          <div className="shrink-0 px-1.5 pt-1 pb-2.5">
            <div className="text-[15px] font-semibold text-fg">Widgets</div>
            <div className="text-[11px] text-dim tabular-nums">
              {onDock} on the dock · {total} available
            </div>
          </div>
          <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[9px] border border-[var(--g-input-line)] bg-input px-2.5 focus-within:border-accent">
            <Search size={14} className="shrink-0 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
                if (e.key === "Enter" && results.length > 0) {
                  const first = results[0];
                  if (!counts.get(first.id)) dockActions.add(first.id);
                }
              }}
              placeholder="Search"
              aria-label="Search widgets"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
            />
            {query && (
              <button type="button" aria-label="Clear search" className="text-faint hover:text-fg" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
          </label>
          <SideItem icon={LayoutGrid} label="All widgets" count={total} active={!searching && atTop} onClick={() => jump(allGroups[0]?.[0] ?? "")} dim={searching} />
          {allGroups.map(([cat, list]) => {
            const hits = searching ? groups.find(([c]) => c === cat)?.[1].length ?? 0 : list.length;
            return (
              <SideItem key={cat} icon={CATEGORY_ICONS[cat]} label={cat} count={hits} active={!searching && !atTop && active === cat} onClick={() => jump(cat)} dim={searching && hits === 0} />
            );
          })}
          {PickerApps && <SideItem icon={Blocks} label="Apps" active={!searching && !atTop && active === APPS_ID} onClick={() => jump(APPS_ID)} />}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 px-5 pt-3.5 pb-2">
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold tracking-tight text-fg">{searching ? `Results for “${query.trim()}”` : "Add widgets"}</h2>
              <p className="text-[11.5px] text-dim">{searching ? `${results.length} widget${results.length === 1 ? "" : "s"}` : "Click a widget to put it on the dock and click again to take it off. Reorder by dragging on the dock."}</p>
            </div>
            <IconButton icon={X} label="Close" onClick={() => useDockUi.setState({ panel: null })} />
          </header>
          <div ref={scroller} className="g-scroll-y relative min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {!loaded && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5 pt-3" aria-busy="true">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="h-[130px] animate-pulse rounded-[12px] border border-card-line bg-input" />
                ))}
              </div>
            )}
            {loaded && groups.length === 0 && !PickerApps && <EmptyState icon={Search} title="Nothing matches" message="Search for something else, for example weather, CPU, clock or revenue." />}
            {groups.map(([cat, list]) => (
              <section key={cat} data-section={cat} className="pt-2 pb-2">
                <h3 className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-[var(--g-card)] px-1 py-1.5 text-[12px] font-semibold text-dim">
                  {(() => {
                    const Icon = CATEGORY_ICONS[cat];
                    return <Icon size={13} className="text-faint" />;
                  })()}
                  {cat}
                  <span className="font-normal text-faint tabular-nums">{list.length}</span>
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
                  {list.map((w) => (
                    <PickerCard key={w.id} def={w} count={counts.get(w.id) ?? 0} scroller={scroller} />
                  ))}
                </div>
              </section>
            ))}
            {PickerApps && (
              <section data-section={APPS_ID} className="pt-2 pb-2">
                <h3 className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-[var(--g-card)] px-1 py-1.5 text-[12px] font-semibold text-dim">
                  <Blocks size={13} className="text-faint" />
                  Apps
                </h3>
                <PickerApps query={query} />
              </section>
            )}
          </div>
        </div>
      </div>
    </Popover>
  );
}

function SideItem({ icon: Icon, label, count, active, onClick, dim }: { icon: LucideIcon; label: string; count?: number; active: boolean; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cx(
        "flex shrink-0 items-center gap-2.5 rounded-[8px] px-2 py-[6px] text-left text-[13px] transition-colors",
        active ? "bg-accent text-on-accent" : "text-fg hover:bg-hover",
        dim && !active && "opacity-45",
      )}
    >
      <Icon size={15} className={active ? undefined : "text-dim"} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className={cx("text-[11px] tabular-nums", active ? "text-on-accent/80" : "text-faint")}>{count}</span>}
    </button>
  );
}

function PickerCard({ def, count, scroller }: { def: AnyWidget; count: number; scroller: RefObject<HTMLDivElement | null> }) {
  const [ref, inView, seen] = useLazyVisible<HTMLButtonElement>(scroller);
  const added = count > 0;
  const width = tileWidth(def.size, PREVIEW_H, PREVIEW_GAP);
  const Preview = def.preview;
  const toggle = () => (added ? dockActions.removeWidget(def.id) : dockActions.add(def.id));
  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-pressed={added}
      title={added ? `Remove ${def.name} from the dock` : `Add ${def.name} to the dock`}
      className={cx(
        "g-press group relative flex flex-col overflow-hidden rounded-[12px] border text-left transition-colors",
        added ? "border-transparent ring-2 ring-accent" : "border-card-line bg-input hover:bg-hover",
      )}
      style={added ? { background: "var(--g-accent-soft)" } : undefined}
    >
      <div className="pointer-events-none relative grid h-[78px] place-items-center overflow-hidden border-b border-card-line" style={{ contain: "layout paint" }}>
        <div style={{ width: Math.min(width, 180), height: PREVIEW_H }}>
          {seen &&
            (Preview ? (
              <Preview size={PREVIEW_H} />
            ) : (
              <TileHost def={def} instanceId={`preview:${def.id}`} config={{}} height={PREVIEW_H} isSample visible={inView} openCard={() => {}} setConfig={() => {}} />
            ))}
          {!seen && <div className="h-full w-full rounded-[10px] bg-tile" />}
        </div>
      </div>
      <div className="flex items-start gap-2 px-2.5 pt-2 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-fg">{def.name}</span>
            <span className="shrink-0 rounded-[4px] border border-card-line px-1 text-[9px] leading-[14px] font-semibold text-faint">{SIZE_LABEL[def.size]}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-dim">{def.description}</div>
        </div>
      </div>
      <span
        className={cx(
          "absolute top-2 right-2 grid h-[20px] w-[20px] place-items-center rounded-full shadow-sm transition-all",
          added ? "bg-accent text-on-accent" : "bg-[var(--g-card)] text-dim opacity-0 group-hover:opacity-100",
        )}
        aria-hidden
      >
        {added ? <Check size={12} strokeWidth={3.2} /> : <Plus size={12} strokeWidth={3} />}
      </span>
      {count > 1 && <span className="absolute top-2 left-2 rounded-full bg-accent px-1.5 text-[10px] leading-[16px] font-semibold text-on-accent tabular-nums">×{count}</span>}
    </button>
  );
}
