import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { needsConnection, useIsSample } from "../core/connections";
import { getWidget, isKnownWidget, useWidget } from "../core/registry";
import { useInView } from "../core/useVisible";
import { tileWidth, type WidgetDef } from "../core/widget";
import { dockAlign, useDockPrefs, useGeneralPrefs, type DockAlign } from "../settings/keys";
import { cx } from "../ui/cx";
import { registerHit, setHitFull } from "./hitRegion";
import {
  alignFactor,
  dockActions,
  fillInset,
  minBarWidth,
  narrowedWidth,
  reorderFor,
  slotOffsets,
  useDock,
  type SlotRect,
  type WidgetInstance,
} from "./layout";
import { currentBarMetrics, useBarMetrics } from "./fit";
import { setOverlayHeight } from "./overlay";
import { Popover } from "./Popover";
import { removeWithAnimation, useRemoving } from "./removal";
import { beginDockDrag, isLocked, reportHover, useCanArrange, useShell } from "./shell";
import { TileHost } from "./TileHost";
import { ui, useDockUi } from "./ui";
import { useSmoothWheel } from "./wheel";

const DRAG_THRESHOLD = 6;
/** Moving the bar by an empty spot starts after this much vertical travel. */
const MOVE_THRESHOLD = 8;

/** The strip at the screen edge: the bar, its tiles, scrolling, dragging, auto-hide. */
export function DockStrip() {
  const edge = useDock((s) => s.edge);
  // At this window's screen fit (fit.ts): smaller on a short screen; the settings keep the set size.
  const { size: sizePx, padding, spacing, distance, thickness } = useBarMetrics();
  const fullWidth = useDock((s) => s.fullWidth);
  const barWidth = useDock((s) => s.barWidth);
  // Settings > Dock > Align widgets (full width only; a pill always fits its widgets).
  const align = useDockPrefs((p) => dockAlign(p.fullWidthAlign));
  const rowAlign: DockAlign = fullWidth ? align : "left";
  const visibility = useShell((s) => s.visibility);
  const canArrange = useCanArrange();
  const barRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tileRadius = Math.round(sizePx * 0.27);
  const barRadius = tileRadius + padding;
  const narrowed = !fullWidth && barWidth > 0;

  // The bar (whole strip height, a little to each side for its shadow) takes clicks.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    return registerHit("bar", el, { kind: "bar", pad: 24 });
  }, []);

  const vars = {
    "--g-radius-tile": `${tileRadius}px`,
    "--g-radius-bar": `${barRadius}px`,
    "--g-dock-distance": `${distance}px`,
  } as CSSProperties;

  /** Press on an empty spot of the bar (not a tile or a control), then drag up/down: move the dock. */
  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isLocked()) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-glintbar-tile], button, input, a, [data-glintbar-handle]")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dy = Math.abs(ev.clientY - sy);
      if (dy > MOVE_THRESHOLD && dy > Math.abs(ev.clientX - sx)) {
        stop();
        ui.closeAll();
        beginDockDrag();
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <div
      className={cx(
        "absolute inset-x-0 flex justify-center",
        edge === "bottom" ? "bottom-0 items-end" : "top-0 items-start",
        visibility === "shown" ? "pointer-events-auto" : "pointer-events-none",
      )}
      style={{ ...vars, height: thickness, [edge === "bottom" ? "paddingBottom" : "paddingTop"]: distance }}
      onPointerEnter={() => reportHover(true)}
      onPointerLeave={() => reportHover(false)}
    >
      <div className="g-dock-slide flex w-full justify-center" data-state={visibility} data-edge={edge}>
        <div
          ref={barRef}
          data-glintbar-bar
          className={cx("g-bar relative flex min-w-0", fullWidth ? "w-full" : "max-w-[calc(100%-16px)]")}
          style={{
            padding,
            height: sizePx + padding * 2 + 2,
            width: narrowed ? barWidth : undefined,
            borderRadius: fullWidth && distance === 0 ? 0 : barRadius,
            marginInline: fullWidth ? distance : undefined,
          }}
          onPointerDown={onBarPointerDown}
        >
          {!fullWidth && canArrange && <EndHandle side="left" barRef={barRef} scroller={scroller} />}
          <DockTiles height={sizePx} spacing={spacing} scroller={scroller} align={rowAlign} />
          {!fullWidth && canArrange && <EndHandle side="right" barRef={barRef} scroller={scroller} />}
        </div>
      </div>
      {visibility === "autohidden" && (
        // The edge sliver: touching it brings the dock back (in Windows the window region is
        // just this line while hidden).
        <div
          className={cx("pointer-events-auto absolute inset-x-0 h-[4px]", edge === "bottom" ? "bottom-0" : "top-0")}
          onPointerEnter={() => reportHover(true)}
        />
      )}
    </div>
  );
}

/** Drag either end of a pill to narrow it (the rest scrolls); double-click to fit the widgets again. */
function EndHandle({ side, barRef, scroller }: { side: "left" | "right"; barRef: RefObject<HTMLDivElement | null>; scroller: RefObject<HTMLDivElement | null> }) {
  const [active, setActive] = useState(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const bar = barRef.current;
    const sc = scroller.current;
    if (!bar || !sc) return;
    const m = currentBarMetrics();
    const start = bar.getBoundingClientRect().width;
    // Natural width: everything visible, plus the bar's padding and border.
    const natural = Math.min(window.innerWidth - 16, sc.scrollWidth + m.padding * 2 + 2);
    const min = minBarWidth({ sizePx: m.size, padding: m.padding });
    const sx = e.clientX;
    setActive(true);
    const move = (ev: PointerEvent) => {
      dockActions.update({ barWidth: narrowedWidth(start, ev.clientX - sx, side, min, natural) });
    };
    const up = () => {
      setActive(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div
      data-glintbar-handle
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Narrow the dock from the left" : "Narrow the dock from the right"}
      title="Drag to make the dock narrower · double-click for the full width"
      className={cx("absolute inset-y-0 z-20 flex w-[9px] cursor-ew-resize items-center justify-center", side === "left" ? "-left-[3px]" : "-right-[3px]")}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        dockActions.update({ barWidth: 0 });
      }}
    >
      <span className="g-end-grip h-[40%] max-h-6 w-[3px] rounded-full bg-fg/35" data-active={active} />
    </div>
  );
}

interface Press {
  id: string;
  startX: number;
  startY: number;
  started: boolean;
  rects: Map<string, SlotRect>;
  order: string[];
  barTop: number;
  barBottom: number;
  tileTop: number;
  tileHeight: number;
  /** alignFactor() at the press: a centred row that loses a tile re-centres. */
  align: number;
}

interface DragView {
  id: string;
  dx: number;
  dy: number;
  order: string[];
  /** Lifted off the bar: released here, the tile is removed. */
  lifted: boolean;
}

interface Settle {
  id: string;
  residual: number;
  phase: 0 | 1;
}

function DockTiles({ height, spacing, scroller, align }: { height: number; spacing: number; scroller: RefObject<HTMLDivElement | null>; align: DockAlign }) {
  const instances = useDock((s) => s.instances);
  const edge = useDock((s) => s.edge);
  const editMode = useDockUi((s) => s.panel === "widgets");
  const canArrange = useCanArrange();
  const removing = useRemoving((s) => s.ids);
  const tileEls = useRef(new Map<string, HTMLElement>());
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDragState] = useState<DragView | null>(null);
  const dragRef = useRef<DragView | null>(null);
  const [settle, setSettle] = useState<Settle | null>(null);
  useSmoothWheel(scroller);

  const setDrag = (d: DragView | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) tileEls.current.set(id, el);
    else tileEls.current.delete(id);
  }, []);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (!p.started) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        p.started = true;
        useDockUi.setState({ card: null, menu: null });
        // Room above the bar and the whole window clickable while a tile is in the air.
        setOverlayHeight("tile-drag", Math.max(140, height * 3));
        setHitFull(true);
      }
      const away = edge === "bottom" ? p.barTop - e.clientY : e.clientY - p.barBottom;
      const lifted = away > Math.max(24, height * 0.6);
      const order = lifted ? p.order.filter((id) => id !== p.id) : reorderFor(p.order, p.rects, p.id, dx);
      setDrag({ id: p.id, dx, dy: lifted ? dy : 0, order, lifted });
    },
    [edge, height],
  );

  const onUp = useCallback(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    const p = press.current;
    press.current = null;
    if (!p?.started) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    setHitFull(false);
    setOverlayHeight("tile-drag", null);
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (d.lifted) {
      // The others already closed the gap; drop the tile without a jump.
      setSettle({ id: d.id, residual: 0, phase: 1 });
      dockActions.remove(d.id);
      return;
    }
    const slots = slotOffsets(p.order, d.order, p.rects, spacing, p.align);
    const residual = d.dx - (slots.get(d.id) ?? 0);
    dockActions.reorder(d.order);
    setSettle({ id: d.id, residual, phase: 0 });
  }, [onMove, spacing]);

  useEffect(() => () => onUp(), [onUp]);

  // Dropped: first frame without transitions at the old spot, then glide into the slot.
  useLayoutEffect(() => {
    if (!settle) return;
    if (settle.phase === 0) {
      const raf = requestAnimationFrame(() => setSettle((s) => (s ? { ...s, phase: 1 } : s)));
      return () => cancelAnimationFrame(raf);
    }
    const t = setTimeout(() => setSettle(null), 220);
    return () => clearTimeout(t);
  }, [settle]);

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0 || !canArrange) return;
    const rects = new Map<string, SlotRect>();
    for (const inst of instances) {
      const el = tileEls.current.get(inst.instanceId);
      if (el) {
        const r = el.getBoundingClientRect();
        rects.set(inst.instanceId, { left: r.left, width: r.width });
      }
    }
    if (!rects.has(id)) return;
    const sc = scroller.current;
    const bar = sc?.getBoundingClientRect();
    const tileBox = tileEls.current.get(id)?.getBoundingClientRect();
    const overflowing = sc ? sc.scrollWidth > sc.clientWidth + 1 : false;
    press.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      rects,
      order: instances.map((i) => i.instanceId),
      barTop: bar?.top ?? 0,
      barBottom: bar?.bottom ?? 0,
      tileTop: tileBox?.top ?? 0,
      tileHeight: tileBox?.height ?? height,
      align: alignFactor(align, overflowing),
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // While dragging the DOM keeps its order; tiles part by sliding (translateX) to their new slots.
  const offsets = drag && press.current ? slotOffsets(press.current.order, drag.order, press.current.rects, spacing, press.current.align) : null;
  const transformFor = (id: string): { x: number; y: number; animate: boolean } => {
    if (drag) {
      if (id === drag.id) return { x: drag.dx, y: drag.dy, animate: false };
      return { x: offsets?.get(id) ?? 0, y: 0, animate: true };
    }
    if (settle) {
      if (id === settle.id) return { x: settle.phase === 0 ? settle.residual : 0, y: 0, animate: settle.phase === 1 };
      return { x: 0, y: 0, animate: false };
    }
    return { x: 0, y: 0, animate: true };
  };

  // Keyboard: arrows move between tiles, Home/End jump, Enter opens the card.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const ids = instances.map((i) => i.instanceId);
    if (ids.length === 0) return;
    const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-glintbar-tile]")?.dataset.glintbarTile;
    let i = current ? ids.indexOf(current) : -1;
    if (e.key === "ArrowRight") i = Math.min(ids.length - 1, i + 1);
    else if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "Home") i = 0;
    else i = ids.length - 1;
    const el = tileEls.current.get(ids[i]);
    if (!el) return;
    e.preventDefault();
    el.focus();
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  };

  return (
    <div
      ref={scroller}
      role="toolbar"
      aria-label="Dock"
      data-align={align}
      // Centre / right: auto margins on the first and last tile (see dock.css). They collapse to 0
      // when the tiles overflow, so the row then starts at the left and scrolls like before.
      className={cx("g-scroll-x flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden", align === "center" && "g-align-center", align === "right" && "g-align-end")}
      // Rounded like the tiles, so one scrolling out at a narrowed bar's end keeps its corners.
      style={{ gap: spacing, borderRadius: "var(--g-radius-tile)" }}
      onKeyDown={onKeyDown}
    >
      {instances.map((inst, index) => {
        const t = transformFor(inst.instanceId);
        return (
          <DockTile
            key={inst.instanceId}
            inst={inst}
            height={height}
            spacing={spacing}
            scroller={scroller}
            fill={align === "fill"}
            dragging={drag?.id === inst.instanceId}
            lifted={drag?.id === inst.instanceId && drag.lifted}
            removing={Boolean(removing[inst.instanceId])}
            x={t.x}
            y={t.y}
            animate={t.animate}
            tabIndex={index === 0 ? 0 : -1}
            editMode={editMode}
            registerEl={registerEl}
            onPointerDown={onPointerDown}
            suppressClick={suppressClick}
          />
        );
      })}
      {drag?.lifted && press.current && <LiftedGhost press={press.current} drag={drag} />}
      {(instances.length === 0 || editMode) && (
        <button
          type="button"
          className="g-press grid shrink-0 place-items-center rounded-tile border border-dashed border-line text-dim hover:bg-tile-hover hover:text-fg"
          style={{ width: height, height }}
          title="Add widgets"
          onClick={() => ui.openPanel("widgets")}
        >
          <Plus size={Math.round(height * 0.4)} />
        </button>
      )}
    </div>
  );
}

function DockTile({
  inst,
  height,
  spacing,
  scroller,
  fill,
  dragging,
  lifted,
  removing,
  x,
  y,
  animate,
  tabIndex,
  editMode,
  registerEl,
  onPointerDown,
  suppressClick,
}: {
  inst: WidgetInstance;
  height: number;
  spacing: number;
  scroller: RefObject<HTMLDivElement | null>;
  /** Settings > Dock > Align widgets > Fill: the tile takes a share of the bar's spare width. */
  fill: boolean;
  dragging: boolean;
  lifted: boolean;
  removing: boolean;
  x: number;
  y: number;
  animate: boolean;
  tabIndex: number;
  editMode: boolean;
  registerEl: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
  suppressClick: RefObject<boolean>;
}) {
  const def = useWidget(inst.widgetId);
  const [viewRef, inView] = useInView<HTMLDivElement>(scroller, "0px 48px");
  const hover = useHoverName(def, inst.instanceId, editMode || dragging);
  const hidden = useDockUi((s) => s.hidden);
  const isSample = useIsSample(def ?? { id: inst.widgetId });
  const elRef = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      viewRef.current = el;
      elRef.current = el;
      registerEl(inst.instanceId, el);
    },
    [viewRef, registerEl, inst.instanceId],
  );

  const openCard = useCallback(() => {
    const el = elRef.current;
    if (!el || !def) return;
    if (!def.Card && !needsConnection(def)) return;
    const r = el.getBoundingClientRect();
    ui.toggleCard(inst.instanceId, { left: r.left, width: r.width });
  }, [def, inst.instanceId]);

  const setConfig = useCallback((patch: Record<string, unknown>) => dockActions.setConfig(inst.instanceId, patch), [inst.instanceId]);

  const fit = def?.fit === "content";
  const width = def ? tileWidth(def.size, height, spacing) : height;
  // Fill: fixed-width tiles grow (the Apps tile keeps its width: its apps are separate cards and
  // its magnification makes room for itself). The surface stretches; the content keeps its natural
  // width, centred, by moving in from each side by `inset` (see dock.css).
  const grow = fill && !fit && !removing;
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const el = elRef.current;
    if (!grow || !el || typeof ResizeObserver === "undefined") {
      setInset(0);
      return;
    }
    const update = () => setInset(fillInset(el.offsetWidth, width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grow, width, def]);
  const style: CSSProperties = {
    // A content-sized tile takes its content's width (it sets its own, see WidgetDef.fit).
    width: removing ? 0 : fit ? undefined : width,
    minWidth: fit && !removing ? height : undefined,
    flexGrow: grow ? 1 : undefined,
    ["--g-fill-inset" as string]: grow && inset > 0 ? `${inset}px` : undefined,
    height,
    marginRight: removing ? -spacing : undefined,
    transform: x || y ? `translate(${x}px, ${y}px)` : undefined,
    transition: animate ? "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
    cursor: dragging ? "grabbing" : undefined,
    zIndex: dragging ? 20 : undefined,
  };

  if (!def && isKnownWidget(inst.widgetId)) {
    // Still loading its code (it is split per widget): an empty tile of the right height.
    return <div ref={setRef} data-glintbar-tile={inst.instanceId} className="g-tile-key shrink-0 rounded-tile bg-tile" style={style} />;
  }

  if (!def) {
    // A widget that no longer exists (renamed/removed): show a removable placeholder.
    return (
      <div
        ref={setRef}
        data-glintbar-tile={inst.instanceId}
        tabIndex={tabIndex}
        title={`Unknown widget ${inst.widgetId}`}
        className={cx("g-tile-key relative grid shrink-0 place-items-center rounded-tile bg-tile text-[10px] text-faint", removing && "g-tile-out")}
        style={style}
        onPointerDown={(e) => onPointerDown(e, inst.instanceId)}
      >
        ?
        {editMode && <RemoveBadge name="unknown widget" onRemove={() => removeWithAnimation(inst.instanceId)} />}
      </div>
    );
  }

  return (
    <div
      ref={setRef}
      data-glintbar-tile={inst.instanceId}
      tabIndex={tabIndex}
      aria-label={def.name}
      data-glintbar-fill={grow && inset > 0 ? "" : undefined}
      className={cx("g-tile-key relative shrink-0 select-none", !dragging && "g-press", lifted && "g-tile-lifted", removing && "g-tile-out")}
      style={style}
      onPointerDown={(e) => onPointerDown(e, inst.instanceId)}
      onPointerEnter={hover.enter}
      onPointerLeave={hover.leave}
      onClick={() => {
        // With the picker showing, the dock is in edit mode: clicks don't open cards.
        if (!suppressClick.current && !editMode) openCard();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !editMode) {
          e.preventDefault();
          openCard();
        } else if ((e.key === "Delete" || e.key === "Backspace") && editMode) {
          e.preventDefault();
          removeWithAnimation(inst.instanceId);
        }
      }}
    >
      <TileHost
        def={def}
        instanceId={inst.instanceId}
        config={inst.config}
        height={height}
        isSample={isSample}
        visible={inView && !hidden}
        openCard={openCard}
        setConfig={setConfig}
        fitContent={fit}
      />
      {editMode && <RemoveBadge name={def.name} onRemove={() => removeWithAnimation(inst.instanceId)} />}
      {hover.anchor && <TileName anchor={hover.anchor} text={def.name} />}
    </div>
  );
}

const NAME_DELAY_MS = 450;

/**
 * Settings > General > Names on hover: the widget's name above (or below, for a top dock) its
 * tile after the pointer rests on it. Hidden while its card, a menu or a panel is open.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useHoverName(def: WidgetDef<any> | undefined, instanceId: string, off: boolean) {
  const enabled = useGeneralPrefs((p) => p.hoverNames) && def !== undefined && def.hoverName !== false && !off;
  const busy = useDockUi((s) => Boolean(s.menu || s.panel || s.card?.instanceId === instanceId || s.hidden));
  const [anchor, setAnchor] = useState<{ left: number; width: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!enabled || busy) {
      clearTimeout(timer.current);
      setAnchor(null);
    }
  }, [enabled, busy]);
  const enter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || busy || e.pointerType === "touch") return;
    const el = e.currentTarget;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setAnchor({ left: r.left, width: r.width });
    }, NAME_DELAY_MS);
  };
  const leave = () => {
    clearTimeout(timer.current);
    setAnchor(null);
  };
  return { anchor: enabled && !busy ? anchor : null, enter, leave };
}

function TileName({ anchor, text }: { anchor: { left: number; width: number }; text: string }) {
  return createPortal(
    <Popover id="tile-name" anchor={anchor} width={Math.min(240, Math.ceil(text.length * 7.2 + 26))} className="pointer-events-none px-2.5 py-1 text-center text-[11.5px] font-medium whitespace-nowrap">
      <span className="truncate">{text}</span>
    </Popover>,
    document.body,
  );
}

/** The tile in the air above the bar (outside the scroller, so it is not clipped): release removes it. */
function LiftedGhost({ press, drag }: { press: Press; drag: DragView }) {
  const r = press.rects.get(drag.id);
  const inst = useDock((s) => s.instances.find((i) => i.instanceId === drag.id));
  const def = inst ? getWidget(inst.widgetId) : undefined;
  if (!r) return null;
  return createPortal(
    <div
      className="g-panel pointer-events-none fixed z-50 flex flex-col items-center justify-center gap-1 text-[11px] text-fg"
      style={{ left: r.left + drag.dx, top: press.tileTop + drag.dy, width: r.width, height: press.tileHeight, borderRadius: "var(--g-radius-tile)" }}
    >
      <Trash2 size={Math.max(12, Math.round(press.tileHeight * 0.3))} className="text-bad" />
      <span className="max-w-full truncate px-1.5 leading-none">{def ? `Remove ${def.name}` : "Remove"}</span>
    </div>,
    document.body,
  );
}

function RemoveBadge({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      className="g-press absolute top-[2px] left-[2px] z-10 grid h-4 w-4 place-items-center rounded-full bg-bad text-white shadow"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <Minus size={11} strokeWidth={3} />
    </button>
  );
}
