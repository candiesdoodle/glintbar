/**
 * Browser preview only (ignored inside GlintBar): `?demo=1` fills the dock with a mix of widgets
 * so every theme can be judged with a full dock (ids that don't exist are skipped);
 * `?ws=black|white|frosted` sets the Clear widget style; `?full=1` makes the dock full width.
 */
import { isKnownWidget, loadWidgets, widgetIds } from "../core/registry";
import { useDock } from "../dock/layout";
import { updateAppearance, type WidgetStyle } from "../settings/keys";

const DEMO = [
  "clocks.clock",
  "weather.now",
  "media.nowplaying",
  "system.cpu",
  "productivity.calendar",
  "finance.stripe",
  "productivity.pomodoro",
  "analytics.plausible",
  "productivity.todos",
];

export function applyDemoParam(): void {
  const p = new URLSearchParams(location.search);
  const ws = p.get("ws");
  if (ws === "black" || ws === "white" || ws === "frosted") updateAppearance({ widgetStyle: ws as WidgetStyle });
  if (p.get("full") === "1") useDock.setState({ fullWidth: true });
  const demo = p.get("demo");
  if (!demo) return;
  const wanted = demo === "1" ? DEMO : demo.split(",");
  let list = wanted.filter((id) => isKnownWidget(id));
  if (list.length === 0) list = widgetIds.slice(0, 8);
  void loadWidgets(list).then(() => useDock.setState({ instances: list.map((id) => ({ instanceId: `${id}#demo`, widgetId: id, config: {} })) }));
}
