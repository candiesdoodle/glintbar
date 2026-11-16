import { lazy, Suspense, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { on } from "../core/backend";
import { CardHost } from "./CardHost";
import { ContextMenu } from "./ContextMenu";
import { DockStrip } from "./DockBar";
import { useKeyboardNav } from "./keyNav";
import { useGeometrySync, useHotkeys, useShell, useShellBridge } from "./shell";
import { ui, useDockUi, type PanelId } from "./ui";
import { WelcomeHint } from "./WelcomeHint";
import "./dock.css";

// The picker and Settings load on first use, so the bar itself comes up fast.
const WidgetPicker = lazy(() => import("../picker/WidgetPicker").then((m) => ({ default: m.WidgetPicker })));
const SettingsPanel = lazy(() => import("../settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

/** Esc closes the top-most popover; a press outside every panel and tile closes them all. */
function useDismissal() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ui.closeTop();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const s = useDockUi.getState();
      const inMenu = Boolean(t?.closest('[data-glintbar-panel="menu"]'));
      if (s.menu && !inMenu) ui.closeMenu();
      // The Apps tile's magnified icons are drawn in a layer of their own: pressing one is pressing the tile.
      if (inMenu || t?.closest("[data-glintbar-panel]") || t?.closest("[data-glintbar-tile], [data-glintbar-magnify]")) return;
      ui.closeAll();
    };
    const onBlur = () => {
      // Clicking another app while we had focus.
      const s = useDockUi.getState();
      if (s.menu || s.card) useDockUi.setState({ menu: null, card: null });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}

/** Tray menu and second launches. */
function useShellEvents() {
  useEffect(() => {
    const offPanel = on<PanelId>("shell", "open-panel", (panel) => ui.openPanel(panel));
    return () => offPanel();
  }, []);
}

/**
 * One right-click handler for the whole dock: on the bar or a tile it opens the dock menu above
 * the bar; inside a card, the picker or Settings it opens at the pointer and leaves them open.
 * A tile or card that shows its own menu calls preventDefault first; text fields keep theirs.
 */
function onContextMenu(e: ReactMouseEvent) {
  if (e.defaultPrevented) return;
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, [contenteditable=true]")) return;
  e.preventDefault();
  if (t.closest('[data-glintbar-panel="menu"]')) return;
  const panel = t.closest<HTMLElement>("[data-glintbar-panel]");
  if (panel) {
    ui.openMenu(e.clientX, panel.dataset.glintbarInstance, { y: e.clientY, inside: true });
    return;
  }
  const tile = t.closest<HTMLElement>("[data-glintbar-tile]");
  ui.openMenu(e.clientX, tile?.dataset.glintbarTile);
}

/** Sends the dock geometry to Rust; its own component so slider drags don't re-render the dock. */
function GeometrySync() {
  useGeometrySync();
  return null;
}

export function Dock() {
  useShellBridge();
  useHotkeys();
  useKeyboardNav();
  useDismissal();
  useShellEvents();
  const panel = useDockUi((s) => s.panel);
  const closing = useShell((s) => s.closing);
  // This window is being closed (Displays changed): unmount every widget first.
  if (closing) return null;
  return (
    <div className="pointer-events-none fixed inset-0 select-none" onContextMenu={onContextMenu}>
      <GeometrySync />
      <DockStrip />
      <CardHost />
      <ContextMenu />
      <WelcomeHint />
      <Suspense fallback={null}>
        {panel === "widgets" && <WidgetPicker />}
        {panel === "settings" && <SettingsPanel />}
      </Suspense>
    </div>
  );
}
