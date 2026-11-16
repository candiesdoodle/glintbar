/** Opens the card of the first tile of a widget that is on the dock. Returns false if none is. */
import { ui } from "../../../dock/ui";

export function openWidgetCard(widgetId: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector<HTMLElement>(`[data-glintbar-tile^="${widgetId}#"]`);
  const instanceId = el?.dataset.glintbarTile;
  if (!el || !instanceId) return false;
  el.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  const r = el.getBoundingClientRect();
  ui.openCard(instanceId, { left: r.left, width: r.width });
  return true;
}
