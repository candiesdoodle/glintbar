import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, LayoutGrid, Lock, LogIn, LogOut, Power, Settings, Trash2 } from "lucide-react";
import { call } from "../core/backend";
import { disconnect as forgetKeys, needsConnection, setConnected, useIsConnected } from "../core/connections";
import { useWidget } from "../core/registry";
import type { WidgetDef } from "../core/widget";
import { useDockPrefs } from "../settings/keys";
import { clamp, cx } from "../ui/cx";
import { registerHit } from "./hitRegion";
import { useStripThickness } from "./fit";
import { useDock } from "./layout";
import { POPOVER_GAP, setOverlayHeight } from "./overlay";
import { Popover } from "./Popover";
import { removeWithAnimation } from "./removal";
import { toggleLock } from "./shell";
import { ui, useDockUi, type MenuState } from "./ui";

interface Item {
  label: string;
  icon: LucideIcon;
  run: () => void;
  danger?: boolean;
  checked?: boolean;
}

const WIDTH = 216;

/** Right-click menu: on the bar, on a tile, and inside cards and panels. */
export function ContextMenu() {
  const menu = useDockUi((s) => s.menu);
  if (!menu) return null;
  return <MenuBody key={`${menu.x}:${menu.y ?? ""}:${menu.instanceId ?? ""}`} menu={menu} />;
}

function MenuBody({ menu }: { menu: MenuState }) {
  const inst = useDock((s) => (menu.instanceId ? s.instances.find((i) => i.instanceId === menu.instanceId) : undefined));
  const locked = useDockPrefs((p) => p.lockDock);
  const def = useWidget(inst?.widgetId ?? "");
  const connected = useIsConnected(def?.id ?? "");

  const groups: Item[][] = [
    [
      { label: "Widgets…", icon: LayoutGrid, run: () => ui.openPanel("widgets") },
      { label: "Settings", icon: Settings, run: () => ui.openPanel("settings") },
    ],
  ];
  if (inst && def && needsConnection(def)) {
    const account = accountItem(def, inst.instanceId, connected);
    if (account) groups.push([account]);
  }
  if (inst) {
    groups.push([
      {
        label: `Remove ${def?.name ?? "widget"}`,
        icon: Trash2,
        run: () => {
          if (useDockUi.getState().card?.instanceId === inst.instanceId) useDockUi.setState({ card: null });
          removeWithAnimation(inst.instanceId);
        },
      },
    ]);
  }
  groups.push([
    { label: "Lock dock", icon: Lock, run: toggleLock, checked: locked },
    { label: "Quit GlintBar", icon: Power, run: () => call("app", "quit"), danger: true },
  ]);

  const list = (
    <div role="menu" className="py-1">
      {groups.map((items, gi) => (
        <div key={gi} className={gi > 0 ? "mt-1 border-t border-card-line pt-1" : undefined}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              className={cx(
                "mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:bg-hover",
                it.danger ? "text-bad" : "text-fg",
              )}
              onClick={() => {
                useDockUi.setState({ menu: null });
                it.run();
              }}
            >
              <it.icon size={15} className={it.danger ? "text-bad" : "text-dim"} />
              <span className="flex-1">{it.label}</span>
              {it.checked && <Check size={14} className="text-accent" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  if (menu.inside && menu.y !== undefined) return <PointMenu x={menu.x} y={menu.y}>{list}</PointMenu>;
  return (
    <Popover id="menu" anchor={{ left: menu.x, width: 0 }} align="start" width={WIDTH}>
      {list}
    </Popover>
  );
}

/**
 * "Connect …" while an account tile shows sample numbers (opens its connect screen), and
 * "Disconnect" / the widget's own wording once it is connected (WidgetDef.disconnect).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accountItem(def: WidgetDef<any>, instanceId: string, connected: boolean): Item | null {
  if (!connected) {
    return {
      label: `Connect ${def.name}…`,
      icon: LogIn,
      run: () => {
        const el = document.querySelector<HTMLElement>(`[data-glintbar-tile="${CSS.escape(instanceId)}"]`);
        const r = el?.getBoundingClientRect();
        ui.openCard(instanceId, r ? { left: r.left, width: r.width } : { left: window.innerWidth / 2, width: 0 });
      },
    };
  }
  const run = def.disconnect ?? (def.connect ? () => forgetKeys(def) : undefined);
  if (!run) return null;
  return {
    label: def.disconnectLabel ?? "Disconnect",
    icon: LogOut,
    run: () => {
      if (useDockUi.getState().card?.instanceId === instanceId) useDockUi.setState({ card: null });
      Promise.resolve(run()).catch(() => setConnected(def.id, false));
    },
  };
}

/** A menu at the pointer (inside a card or panel), kept on screen. */
function PointMenu({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const edge = useDock((s) => s.edge);
  const thickness = useStripThickness();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = clamp(x, 8, vw - WIDTH - 8);
    const top = clamp(y + h > vh - 8 ? y - h : y, 8, Math.max(8, vh - h - 8));
    setPos({ left, top });
    // Room for the menu above the strip, measured from the screen edge.
    const far = edge === "bottom" ? vh - top : top + h;
    setOverlayHeight("point-menu", far - thickness + POPOVER_GAP);
    const unhit = registerHit("point-menu", el, { pad: 36 });
    return () => {
      unhit();
      setOverlayHeight("point-menu", null);
    };
  }, [x, y, edge, thickness]);

  return (
    <div
      ref={ref}
      data-glintbar-panel="menu"
      className="g-panel g-menu-in pointer-events-auto fixed z-40 overflow-hidden text-fg"
      style={{ width: WIDTH, left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>
  );
}
