/**
 * Browser-preview helpers (ignored inside Tauri):
 *   ?theme=white  ?edge=top  ?size=58  ?panel=widgets|settings  ?section=dock
 *   ?card=system.cpu (opens the first tile of that widget)  ?reset=1 (forget saved state)
 *   ?menu=1 (the dock's right-click menu)  ?menu=card (right-click inside the open card)
 *   ?autohide=1  ?width=220 (a narrowed pill)  ?full=1 (full width)  ?more=8 (add 8 more widgets)
 *   ?align=center|right|fill (full-width alignment)  ?magnify=1.8 (magnification on at that size)
 *   ?dock=system.cpu,clocks.clock (exactly these widgets)  ?card= also adds the widget if missing
 *   ?welcome=1 / ?welcome=0 (show / skip the first-run hint)  ?keys=1 (keyboard navigation, as Win+Alt+T)
 *   ?fit=0.8 (draw the bar at this screen fit factor, as Rust would on a short screen)
 */
import { setStored, updateSettings, type ThemeId } from "../core/store";
import { isKnownWidget, loadAllWidgets } from "../core/registry";
import { dockActions, useDock } from "./layout";
import { ui, type PanelId } from "./ui";
import { WELCOME_KEY } from "./WelcomeHint";
import { startKeyboardNav } from "./keyNav";
import { updateDockPrefs } from "../settings/keys";
import { forceFit } from "./fit";

export async function applyDevParams(): Promise<void> {
  const p = new URLSearchParams(location.search);
  if (p.get("reset") === "1") {
    localStorage.clear();
    p.delete("reset");
    location.search = p.toString();
    return;
  }
  const theme = p.get("theme");
  if (theme) updateSettings({ theme: theme as ThemeId });
  const edge = p.get("edge");
  if (edge === "top" || edge === "bottom") dockActions.update({ edge });
  const size = Number(p.get("size"));
  if (size) dockActions.update({ sizePx: size, sizePreset: "custom" });
  const dock = p.get("dock");
  if (dock) {
    const ids = dock.split(",").filter(isKnownWidget);
    useDock.setState({ instances: ids.map((id, i) => ({ instanceId: `${id}#dev${i}`, widgetId: id, config: {} })) });
  }
  const more = Number(p.get("more"));
  if (more > 0) {
    const have = new Set(useDock.getState().instances.map((i) => i.widgetId));
    (await loadAllWidgets()).filter((w) => !have.has(w.id)).slice(0, more).forEach((w) => dockActions.add(w.id));
  }
  const welcome = p.get("welcome");
  if (welcome === "1" || welcome === "0") setStored(WELCOME_KEY, welcome === "0");
  if (p.get("autohide") === "1") dockActions.update({ autoHide: true });
  const width = Number(p.get("width"));
  if (width) dockActions.update({ barWidth: width, fullWidth: false });
  if (p.get("full") === "1") dockActions.update({ fullWidth: true });
  const align = p.get("align");
  if (align === "left" || align === "center" || align === "right" || align === "fill") updateDockPrefs({ fullWidthAlign: align });
  const magnify = Number(p.get("magnify"));
  if (magnify) updateDockPrefs({ magnification: true, magnifyScale: Math.max(1.2, Math.min(2, magnify)) });
  if (p.get("highlight") === "1") updateDockPrefs({ highlightActive: true });
  const fit = Number(p.get("fit"));
  if (fit) forceFit(fit);
  if (p.get("keys") === "1") setTimeout(startKeyboardNav, 400);
  const menu = p.get("menu");
  if (menu) {
    setTimeout(() => {
      if (menu === "card") {
        const panel = document.querySelector<HTMLElement>('[data-glintbar-panel="card"]');
        if (!panel) return;
        const r = panel.getBoundingClientRect();
        ui.openMenu(r.left + 40, panel.dataset.glintbarInstance, { y: r.top + 40, inside: true });
        return;
      }
      const tile = document.querySelector<HTMLElement>("[data-glintbar-tile]");
      const r = tile?.getBoundingClientRect();
      ui.openMenu(r ? r.left + 10 : window.innerWidth / 2, tile?.dataset.glintbarTile);
    }, menu === "card" ? 700 : 300);
  }
  const panel = p.get("panel");
  if (panel) ui.openPanel(panel as PanelId, p.get("section") ?? undefined);
  const card = p.get("card");
  if (card && isKnownWidget(card) && !useDock.getState().instances.some((i) => i.widgetId === card)) dockActions.add(card);
  if (card) {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-glintbar-tile^="${card}#"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      ui.openCard(el.dataset.glintbarTile!, { left: r.left, width: r.width });
    }, 300);
  }
}
