/** Transient dock UI state (not persisted): which card, menu or panel is open. */
import { create } from "zustand";

export interface Anchor {
  /** Client-space left edge and width of the element the popover belongs to. */
  left: number;
  width: number;
}

export type PanelId = "widgets" | "settings";

export interface MenuState {
  x: number;
  /** Client y of the right-click; used for menus opened inside a card or panel. */
  y?: number;
  instanceId?: string;
  /** Opened inside a card or panel: shows at the pointer and leaves the card/panel open. */
  inside?: boolean;
}

interface DockUi {
  card: { instanceId: string; anchor: Anchor } | null;
  menu: MenuState | null;
  panel: PanelId | null;
  settingsSection: string;
  /** Auto-hidden or under a full-screen app (shell slice). Hidden docks pause every tile. */
  hidden: boolean;
}

export const useDockUi = create<DockUi>()(() => ({
  card: null,
  menu: null,
  panel: null,
  settingsSection: "general",
  hidden: false,
}));

/**
 * Popovers that keep their own open state (the Apps tile's menus and previews) register a
 * dismisser here, so Esc and clicks in other apps close them exactly like the dock's own card,
 * menu and panels. A dismisser closes what it has open and returns true if there was something.
 */
type Dismisser = () => boolean;
const dismissers = new Set<Dismisser>();

export function onDismiss(fn: Dismisser): () => void {
  dismissers.add(fn);
  return () => {
    dismissers.delete(fn);
  };
}

function runDismissers(): boolean {
  let closed = false;
  for (const fn of dismissers) {
    try {
      if (fn()) closed = true;
    } catch {
      /* a broken dismisser must not keep the rest open */
    }
  }
  return closed;
}

export const ui = {
  openCard(instanceId: string, anchor: Anchor) {
    useDockUi.setState({ card: { instanceId, anchor }, menu: null, panel: null });
  },
  toggleCard(instanceId: string, anchor: Anchor) {
    const cur = useDockUi.getState().card;
    if (cur?.instanceId === instanceId) useDockUi.setState({ card: null });
    else ui.openCard(instanceId, anchor);
  },
  /** Right-click menu. From the bar it replaces any open card; inside a card or panel it stays on top of it. */
  openMenu(x: number, instanceId?: string, opts: { y?: number; inside?: boolean } = {}) {
    const menu: MenuState = { x, instanceId, y: opts.y, inside: opts.inside };
    if (opts.inside) useDockUi.setState({ menu });
    else useDockUi.setState({ menu, card: null });
  },
  closeMenu() {
    if (useDockUi.getState().menu) useDockUi.setState({ menu: null });
  },
  openPanel(panel: PanelId, section?: string) {
    useDockUi.setState((s) => ({ panel, menu: null, card: null, settingsSection: section ?? s.settingsSection }));
  },
  /** Everything: a click outside the dock, the smoke harness, a full-screen app. */
  closeAll() {
    runDismissers();
    const s = useDockUi.getState();
    if (s.card || s.menu || s.panel) useDockUi.setState({ card: null, menu: null, panel: null });
  },
  /** Esc: close the top-most thing. */
  closeTop() {
    // A tile's own popover sits above the dock's (opening one closes the dock's card and menu).
    if (runDismissers()) return;
    const s = useDockUi.getState();
    if (s.menu) useDockUi.setState({ menu: null });
    else if (s.card) useDockUi.setState({ card: null });
    else if (s.panel) useDockUi.setState({ panel: null });
  },
};
