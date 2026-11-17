import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { registerHit } from "../../../dock/hitRegion";
import { setOverlayHeight } from "../../../dock/overlay";
import { createPortal } from "react-dom";
import { call } from "../../../core/backend";
import type { TileProps } from "../../../core/widget";
import { useDock } from "../../../dock/layout";
import { Popover } from "../../../dock/Popover";
import type { Anchor } from "../../../dock/ui";
import { cx, TileFrame, TileSampleBadge } from "../../../ui";
import { activate, focusWindow, launchEntry, relaunchTarget } from "../shared/actions";
import { useFileDrop } from "../shared/dragdrop";
import {
  buildDockApps,
  entryFromWindow,
  groupPins,
  hasPin,
  movePin,
  removePin,
  type DockApp,
} from "../shared/grouping";
import { anchorOf, closePopup, openPopup, usePopup, type PopupKind } from "../shared/popups";
import { SAMPLE_PINS } from "../shared/sample";
import { useWindows } from "../shared/useWindows";
import { isGroup, type AppEntry, type Pin, type PinGroup } from "../types";
import { AppMenu } from "./AppMenu";
import { AppVisual } from "./AppVisual";
import { metrics, useAppsView, type AppsConfig } from "./config";
import { GroupPanel } from "./GroupPanel";
import { Magnifier, magnifyRoom, magnifySpread, type ItemHandlers, type MagnifyItem } from "./Magnifier";
import { Previews } from "./Previews";
import { StackPanel } from "./StackPanel";

const START_KEY = "__start";
const DRAG_THRESHOLD = 6;
const GROUP_HOLD_MS = 420;

interface Drag {
  key: string;
  from: number;
  pinned: boolean;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  started: boolean;
  rects: Map<string, { left: number; width: number }>;
  insert: number;
  groupOnto: number | null;
  candidate: number | null;
  candidateSince: number;
  off: boolean;
}

function HoverLabel({ anchor, text }: { anchor: Anchor; text: string }) {
  return createPortal(
    <Popover id="apps-label" anchor={anchor} width={Math.min(280, Math.ceil(text.length * 7.4 + 28))} className="pointer-events-none px-2.5 py-1 text-center text-[11.5px] whitespace-nowrap">
      <span className="truncate">{text}</span>
    </Popover>,
    document.body,
  );
}

export function AppsTile({ instanceId, config: own, setConfig, size, openCard, isSample }: TileProps<AppsConfig>) {
  const config = useAppsView(own);
  const spacing = useDock((s) => s.spacing);
  const edge = useDock((s) => s.edge);
  const m = metrics(size, config, config.style === "cards" ? spacing : 0);
  const windows = useWindows(isSample);
  const pins: Pin[] = isSample ? SAMPLE_PINS : (config.pins ?? []);

  // First run: start from the Windows taskbar's own pins.
  const seeded = useRef(false);
  useEffect(() => {
    if (isSample || config.pins !== undefined || seeded.current) return;
    seeded.current = true;
    call<AppEntry[]>("apps", "taskbar_pins")
      .then((list) => setConfig({ pins: list ?? [] }))
      .catch(() => setConfig({ pins: [] }));
  }, [isSample, config.pins, setConfig]);

  const seen = useRef(new Map<string, number>());
  const apps = useMemo(
    () => buildDockApps(pins, windows ?? [], { showRunning: config.showRunning, seen: seen.current }),
    [pins, windows, config.showRunning],
  );
  const pinnedCount = pins.length;
  const runningCount = apps.length - pinnedCount;

  const setPins = useCallback((next: Pin[]) => setConfig({ pins: next }), [setConfig]);

  // ---- layout ---------------------------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const slots = (config.showStart ? 1 : 0) + apps.length;
  const divider = pinnedCount > 0 && runningCount > 0;
  const dividerW = divider ? (config.style === "cards" ? 1 + m.gap : 9) : 0;
  const empty = slots === 0;
  const width = empty
    ? size * 2
    : slots * m.slot + Math.max(0, slots - 1) * m.gap + dividerW + m.pad * 2;

  // ---- floating panels -------------------------------------------------------------------------
  const popup = usePopup((s) => (s.open && s.open.owner === instanceId ? s.open : null));
  const show = useCallback(
    (kind: PopupKind, key: string) => openPopup({ kind, owner: instanceId, key, anchor: anchorOf(els.current.get(key) ?? null) }),
    [instanceId],
  );
  const keepOn = useCallback((): Element | null => {
    if (!popup) return null;
    // While magnifying, presses land on the enlarged copy of the item, not the item itself.
    const copy = document.querySelector(`[data-glintbar-magnify="${CSS.escape(instanceId)}"] [data-mag-key="${CSS.escape(popup.key)}"]`);
    return copy ?? els.current.get(popup.key) ?? null;
  }, [popup, instanceId]);
  const popupApp = popup ? apps.find((a) => a.key === popup.key) : undefined;
  useEffect(() => {
    if (popup && popup.key !== START_KEY && !popupApp) closePopup();
  }, [popup, popupApp]);

  // ---- hover: names and previews ----------------------------------------------------------------
  const [hovered, setHovered] = useState<string | null>(null);
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const timers = useRef<{ label?: ReturnType<typeof setTimeout>; preview?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});
  const clearTimer = (k: "label" | "preview" | "close") => {
    clearTimeout(timers.current[k]);
    timers.current[k] = undefined;
  };
  useEffect(() => () => ["label", "preview", "close"].forEach((k) => clearTimer(k as "label")), []);

  const enter = (app: DockApp | null, key: string) => {
    setHovered(key);
    clearTimer("label");
    clearTimer("preview");
    clearTimer("close");
    if (config.hoverNames && !config.magnify) timers.current.label = setTimeout(() => setLabelFor(key), 320);
    const cur = usePopup.getState().open;
    if (config.previews && app && app.windows.length > 0 && app.kind !== "group") {
      const delay = cur?.kind === "preview" && cur.owner === instanceId ? 60 : 520;
      timers.current.preview = setTimeout(() => {
        setLabelFor(null);
        show("preview", key);
      }, delay);
    } else if (cur?.kind === "preview" && cur.owner === instanceId) {
      closePopup("preview");
    }
  };
  const leave = () => {
    setHovered(null);
    setLabelFor(null);
    clearTimer("label");
    clearTimer("preview");
    if (usePopup.getState().open?.kind === "preview") timers.current.close = setTimeout(() => closePopup("preview"), 280);
  };

  // ---- magnification ------------------------------------------------------------------------------
  const [mag, setMag] = useState<{ x: number; items: MagnifyItem[] } | null>(null);
  const raf = useRef(0);
  // Pointer inside the tile, including its magnified copies (React enter/leave follow portals).
  const [inside, setInside] = useState(false);
  const insideRef = useRef(false);
  const measure = useCallback((): MagnifyItem[] => {
    const out: MagnifyItem[] = [];
    if (config.showStart) {
      const el = els.current.get(START_KEY);
      if (el) out.push({ key: START_KEY, start: true, rect: rectOf(el) });
    }
    for (const a of apps) {
      const el = els.current.get(a.key);
      if (el) out.push({ key: a.key, app: a, rect: rectOf(el) });
    }
    return out;
  }, [apps, config.showStart]);
  const onRootMove = (e: RPointerEvent) => {
    if (!config.magnify || isSample || dragRef.current?.started) return;
    const x = e.clientX;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setMag({ x, items: measure() }));
  };
  const onRootEnter = () => {
    insideRef.current = true;
    setInside(true);
  };
  const onRootLeave = () => {
    insideRef.current = false;
    setInside(false);
    cancelAnimationFrame(raf.current);
    // Magnified apps stay put while one of their menus is open.
    if (usePopup.getState().open?.owner === instanceId && usePopup.getState().open?.kind === "menu") return;
    setMag(null);
  };
  useEffect(() => {
    if (!popup && mag && !insideRef.current) setMag(null);
  }, [popup, mag]);
  useEffect(() => {
    if (!mag) return;
    const onResize = () => setMag((cur) => (cur ? { x: cur.x, items: measure() } : cur));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mag, measure]);
  useEffect(() => {
    if (!config.magnify) setMag(null);
  }, [config.magnify]);
  // Room for the magnified icons on both sides (the dock grows while you point at it).
  const magPad = config.magnify && mag ? Math.ceil(magnifySpread(config.magnifyScale) * m.slot) : 0;
  // While the pointer is on the tile the window keeps room above the strip for the biggest icon
  // (the window only ever grows, so this never resizes it twice), and the window region takes in
  // that band over the tile so the enlarged icons are drawn and clickable. Released on leave.
  const magRoom = magnifyRoom(config.magnifyScale, m.height, config.hoverNames);
  const reserveMag = config.magnify && !isSample && (inside || !!mag);
  useEffect(() => {
    if (!reserveMag) return;
    setOverlayHeight("apps-magnify", magRoom);
    const el = rootRef.current;
    const unhit = el ? registerHit(`apps-magnify:${instanceId}`, el, { kind: "panel", pad: 4, grow: magRoom }) : () => {};
    return () => {
      unhit();
      setOverlayHeight("apps-magnify", null);
    };
  }, [reserveMag, magRoom, instanceId]);
  // Menus and previews sit above the magnified icons, not over them.
  const lift = config.magnify && !isSample ? magRoom : 0;
  useEffect(() => {
    usePopup.setState({ lift });
    return () => usePopup.setState({ lift: 0 });
  }, [lift]);

  // ---- drag to reorder, group, or drag off to unpin --------------------------------------------
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragView] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const groupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.dx = e.clientX - d.startX;
      d.dy = e.clientY - d.startY;
      if (!d.started) {
        if (Math.hypot(d.dx, d.dy) < DRAG_THRESHOLD) return;
        d.started = true;
        setMag(null);
        setLabelFor(null);
        closePopup();
      }
      const me = d.rects.get(d.key);
      if (!me) return;
      const center = me.left + me.width / 2 + d.dx;
      d.off = d.pinned && Math.abs(d.dy) > m.height * 1.3;
      // Insert position among the pins.
      let insert = 0;
      let candidate: number | null = null;
      for (let i = 0; i < pinnedCount; i++) {
        const k = apps[i].key;
        if (k === d.key) continue;
        const r = d.rects.get(k);
        if (!r) continue;
        const c = r.left + r.width / 2;
        if (c < center) insert++;
        if (Math.abs(center - c) < r.width * 0.22 && apps[i].kind !== "folder" && apps[i].kind !== "file" && apps[d.from]?.kind !== "group") {
          candidate = i;
        }
      }
      d.insert = insert;
      if (candidate !== d.candidate) {
        d.candidate = candidate;
        d.groupOnto = null;
        clearTimeout(groupTimer.current);
        if (candidate !== null && d.pinned) {
          groupTimer.current = setTimeout(() => {
            if (dragRef.current === d && d.candidate === candidate) {
              d.groupOnto = candidate;
              setDragView({ ...d });
            }
          }, GROUP_HOLD_MS);
        }
      }
      setDragView({ ...d });
    },
    [apps, pinnedCount, m.height],
  );

  const onUp = useCallback(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    clearTimeout(groupTimer.current);
    const d = dragRef.current;
    dragRef.current = null;
    setDragView(null);
    if (!d?.started) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const app = apps[d.from];
    if (!app) return;
    if (d.pinned) {
      if (d.off) setPins(removePin(pins, app.key));
      else if (d.groupOnto !== null) setPins(groupPins(pins, d.from, d.groupOnto));
      else if (d.insert !== d.from) setPins(movePin(pins, d.from, d.insert));
    } else if (app.windows[0] && Math.abs(d.dy) < m.height * 1.3) {
      // Dropping a running app between the pins pins it.
      const entry = entryFromWindow(app.windows[0]);
      if (!hasPin(pins, entry.id)) {
        const next = [...pins];
        next.splice(Math.min(d.insert, next.length), 0, entry);
        setPins(next);
      }
    }
  }, [onMove, apps, pins, setPins, m.height]);

  useEffect(() => () => onUp(), [onUp]);

  const startDrag = (e: RPointerEvent, app: DockApp, index: number) => {
    if (e.button !== 0) return;
    const rects = new Map<string, { left: number; width: number }>();
    for (const a of apps) {
      const el = els.current.get(a.key);
      if (el) {
        const r = el.getBoundingClientRect();
        rects.set(a.key, { left: r.left, width: r.width });
      }
    }
    dragRef.current = {
      key: app.key,
      from: index,
      pinned: index < pinnedCount,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      started: false,
      rects,
      insert: index,
      groupOnto: null,
      candidate: null,
      candidateSince: 0,
      off: false,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // ---- files dragged in from Explorer -----------------------------------------------------------
  const [dropOver, setDropOver] = useState<string | null | undefined>(undefined);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFileDrop(`apps:${instanceId}`, (ev) => {
    if (isSample) return;
    const key = ev.target?.closest<HTMLElement>("[data-app-key]")?.dataset.appKey ?? null;
    if (ev.type === "leave") {
      clearTimeout(dropTimer.current);
      setDropOver(undefined);
      return;
    }
    if (ev.type === "over") {
      if (key !== dropOver) {
        clearTimeout(dropTimer.current);
        const app = apps.find((a) => a.key === key);
        // Hovering a dragged file over an open app brings it to the front, to drop into it.
        if (app?.windows[0]) dropTimer.current = setTimeout(() => focusWindow(app.windows[0]), 650);
      }
      setDropOver(key);
      return;
    }
    clearTimeout(dropTimer.current);
    setDropOver(undefined);
    if (!ev.paths.length) return;
    const at = key ? apps.findIndex((a) => a.key === key) : -1;
    call<AppEntry[]>("apps", "resolve", { paths: ev.paths })
      .then((entries) => {
        const fresh = (entries ?? []).filter((x) => !hasPin(pins, x.id));
        if (!fresh.length) return;
        const next = [...pins];
        next.splice(at >= 0 && at < pinnedCount ? at + 1 : next.length, 0, ...fresh);
        setPins(next);
      })
      .catch((e) => console.warn("apps: could not pin", e));
  });

  // ---- actions ----------------------------------------------------------------------------------
  const onItemClick = (e: RMouseEvent, app: DockApp) => {
    e.stopPropagation();
    if (suppressClick.current || isSample) return;
    clearTimer("preview");
    setLabelFor(null);
    const cur = usePopup.getState().open;
    if (cur?.owner === instanceId && cur.key === app.key && (cur.kind === "stack" || cur.kind === "group")) {
      closePopup();
      return;
    }
    if (cur?.kind === "preview") closePopup("preview");
    if (e.shiftKey || e.ctrlKey) {
      const again = relaunchTarget(app);
      if (again) launchEntry(again, { admin: e.ctrlKey && e.shiftKey });
      return;
    }
    const next = activate(app);
    if (next) show(next, app.key);
  };

  const pinApp = (app: DockApp) => {
    const w = app.windows[0];
    if (!w) return;
    const entry = entryFromWindow(w);
    if (!hasPin(pins, entry.id)) setPins([...pins, entry]);
  };

  const renameGroup = (g: PinGroup, name: string) => setPins(pins.map((p) => (isGroup(p) && p.id === g.id ? { ...p, name } : p)));
  const ungroup = (g: PinGroup) => setPins(pins.flatMap((p) => (isGroup(p) && p.id === g.id ? p.items : [p])));

  // ---- render -----------------------------------------------------------------------------------
  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };
  const magnifying = !!mag && config.magnify && !drag?.started;

  /** Pointer and click handlers of one app; the magnified copy of the app gets the same ones. */
  const itemHandlers = (app: DockApp, index: number): ItemHandlers =>
    isSample
      ? {}
      : {
          onPointerDown: (e) => {
            e.stopPropagation();
            startDrag(e, app, index);
          },
          onPointerEnter: () => enter(app, app.key),
          onPointerLeave: leave,
          onClick: (e) => onItemClick(e, app),
          onAuxClick: (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            const again = relaunchTarget(app);
            if (again) launchEntry(again);
          },
          onContextMenu: (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearTimer("preview");
            setLabelFor(null);
            show("menu", app.key);
          },
        };
  const startHandlers: ItemHandlers = isSample
    ? {}
    : {
        onPointerDown: (e) => e.stopPropagation(),
        onPointerEnter: () => enter(null, START_KEY),
        onPointerLeave: leave,
        onClick: (e) => {
          e.stopPropagation();
          setLabelFor(null);
          call("apps", "start_menu").catch(() => {});
        },
        onContextMenu: (e) => {
          e.preventDefault();
          e.stopPropagation();
          setLabelFor(null);
          call("apps", "quick_menu").catch(() => {});
        },
      };
  const bindMagnified = (key: string): ItemHandlers => {
    if (key === START_KEY) return startHandlers;
    const index = apps.findIndex((a) => a.key === key);
    return index >= 0 ? itemHandlers(apps[index], index) : {};
  };

  const item = (app: DockApp, index: number): ReactNode => {
    const dragging = drag?.started && drag.key === app.key;
    const isTarget = drag?.groupOnto === index || (dropOver !== undefined && dropOver === app.key);
    return (
      <div
        key={app.key}
        ref={register(app.key)}
        data-app-key={app.key}
        role="button"
        aria-label={app.name}
        className={cx("relative shrink-0", !isSample && "g-press", dragging && "z-20")}
        style={{
          opacity: magnifying ? 0 : dragging && drag?.off ? 0.35 : 1,
          transform: dragging ? `translate(${drag!.dx}px, ${Math.max(-m.height * 2, Math.min(m.height * 2, drag!.dy))}px)` : undefined,
          transition: dragging ? "none" : undefined,
        }}
        {...itemHandlers(app, index)}
      >
        <AppVisual app={app} m={m} style={config.style} highlight={isTarget} showActive={config.highlightActive} />
      </div>
    );
  };

  const insertBar = (() => {
    if (!drag?.started || drag.groupOnto !== null || drag.off || !rootRef.current) return null;
    if (drag.pinned && drag.insert === drag.from) return null;
    const root = rootRef.current.getBoundingClientRect();
    const keys = apps.slice(0, pinnedCount).map((a) => a.key).filter((k) => k !== drag.key);
    let x: number;
    if (keys.length === 0) x = (config.showStart ? m.slot + m.gap : 0) + m.pad;
    else if (drag.insert >= keys.length) {
      const r = drag.rects.get(keys[keys.length - 1])!;
      x = r.left + r.width - root.left + m.gap / 2;
    } else {
      const r = drag.rects.get(keys[drag.insert])!;
      x = r.left - root.left - m.gap / 2;
    }
    return <span className="pointer-events-none absolute top-[12%] bottom-[12%] z-10 w-[3px] -translate-x-1/2 rounded-full bg-accent" style={{ left: x }} />;
  })();

  const content = (
    <>
      {config.showStart && (
        <div
          ref={register(START_KEY)}
          role="button"
          aria-label="Start"
          title={config.hoverNames && !config.magnify ? undefined : "Start"}
          className={cx("relative shrink-0", !isSample && "g-press")}
          style={{ opacity: magnifying ? 0 : 1 }}
          {...startHandlers}
        >
          <AppVisual start m={m} style={config.style} />
        </div>
      )}
      {apps.slice(0, pinnedCount).map((a, i) => item(a, i))}
      {divider && <span className={cx("shrink-0 self-center rounded-full bg-line", config.style === "icons" && "mx-1")} style={{ width: 1, height: m.height * 0.56, background: "var(--g-tile-line)", boxShadow: "0 0 0 0.5px var(--g-dim)" }} />}
      {apps.slice(pinnedCount).map((a, i) => item(a, pinnedCount + i))}
      {empty && (
        <div className="grid h-full w-full place-items-center rounded-tile border border-dashed border-line px-2 text-center text-[11px] leading-tight text-dim">
          Drop apps here
        </div>
      )}
      {insertBar}
    </>
  );

  const hoveredApp = labelFor ? apps.find((a) => a.key === labelFor) : undefined;
  const labelText = labelFor === START_KEY ? "Start" : hoveredApp?.name;
  const labelEl = labelFor ? els.current.get(labelFor) : undefined;

  return (
    <div
      ref={rootRef}
      data-glintbar-drop={`apps:${instanceId}`}
      className={cx("glintbar-apps-root relative h-full", dropOver !== undefined && "rounded-tile ring-2 ring-accent/70")}
      style={{ width: isSample ? "100%" : width + magPad * 2, paddingInline: magPad }}
      onPointerMove={onRootMove}
      onPointerEnter={onRootEnter}
      onPointerLeave={onRootLeave}
    >
      {config.style === "cards" ? (
        <div className="relative flex h-full items-center" style={{ gap: m.gap }}>
          {content}
        </div>
      ) : (
        <TileFrame padded={false} className="relative" style={{ paddingInline: m.pad }}>
          {content}
        </TileFrame>
      )}
      {isSample && <TileSampleBadge />}

      {magnifying && mag && (
        <Magnifier owner={instanceId} items={mag.items} x={mag.x} max={config.magnifyScale} m={m} style={config.style} edge={edge} label={config.hoverNames} showActive={config.highlightActive} bind={bindMagnified} />
      )}
      {labelText && labelEl && !popup && !drag?.started && hovered === labelFor && <HoverLabel anchor={anchorOf(labelEl)} text={labelText} />}

      {popup?.kind === "menu" && popupApp && (
        <AppMenu
          app={popupApp}
          anchor={popup.anchor}
          pinned={popupApp.pin !== undefined || popupApp.group !== undefined}
          isSample={isSample}
          keepOpenOn={keepOn}
          onPin={() => pinApp(popupApp)}
          onUnpin={() => setPins(removePin(pins, popupApp.key))}
          onSettings={openCard}
        />
      )}
      {popup?.kind === "preview" && popupApp && popupApp.windows.length > 0 && (
        <Previews app={popupApp} anchor={popup.anchor} onEnter={() => clearTimer("close")} onLeave={() => (timers.current.close = setTimeout(() => closePopup("preview"), 280))} />
      )}
      {popup?.kind === "stack" && popupApp?.pin && <StackPanel entry={popupApp.pin} anchor={popup.anchor} keepOpenOn={keepOn} />}
      {popup?.kind === "group" && popupApp?.group && (
        <GroupPanel
          group={popupApp.group}
          windows={windows ?? []}
          anchor={popup.anchor}
          m={m}
          style={config.style}
          keepOpenOn={keepOn}
          onRename={(name) => renameGroup(popupApp.group!, name)}
          onUngroup={() => ungroup(popupApp.group!)}
          onStack={(a) => a.pin && launchEntry(a.pin)}
        />
      )}
    </div>
  );
}

function rectOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
