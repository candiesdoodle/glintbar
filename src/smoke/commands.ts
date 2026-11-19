/**
 * The command channel: the PowerShell driver writes smoke/command.json {id, action, args}; this
 * polls it, runs the action, and writes smoke/command-result.json {id, ok, result | error}.
 */
import { call } from "../core/backend";
import { isKnownWidget, loadAllWidgets, loadWidget, loadWidgets, widgetIds, getWidget } from "../core/registry";
import { updateSettings, type ThemeId } from "../core/store";
import { needsConnection } from "../core/connections";
import { editDockMeasures } from "../dock/fit";
import { dockActions, SIZE_PRESETS, useDock, type Edge, type WidgetInstance } from "../dock/layout";
import { ui, useDockUi, type PanelId } from "../dock/ui";
import { formatValue } from "./console";
import { quietFor, quietLeft, readSmokeFile, sleep, writeSmokeJson } from "./io";
import { dumpLayout } from "./layout";
import { runSelftest } from "./selftest";
import * as probes from "./probes";
import { planBatches, recordTiles } from "./tiles";

export interface Command {
  id: string;
  action: string;
  args?: unknown;
}

const THEMES: ThemeId[] = ["black", "white", "midnight", "glass", "ios-glass", "clear"];

let originalDock: WidgetInstance[] | null = null;
let batchStart = Date.now();

function arg<T>(args: unknown, key: string): T | undefined {
  if (args && typeof args === "object" && !Array.isArray(args)) return (args as Record<string, T>)[key];
  return undefined;
}

/** The first tile of `widgetId` (added if missing), then its card opened like a click would. */
async function openCard(widgetId: string) {
  if (!isKnownWidget(widgetId)) throw new Error("unknown widget " + widgetId);
  await loadWidget(widgetId);
  if (!useDock.getState().instances.some((i) => i.widgetId === widgetId)) {
    dockActions.add(widgetId);
    await sleep(400);
  }
  const el = document.querySelector<HTMLElement>('[data-glintbar-tile^="' + CSS.escape(widgetId) + '#"]');
  if (!el) throw new Error("no tile for " + widgetId);
  el.scrollIntoView({ inline: "nearest", block: "nearest" });
  const r = el.getBoundingClientRect();
  ui.openCard(el.dataset.glintbarTile!, { left: r.left, width: r.width });
  const def = getWidget(widgetId);
  return { instanceId: el.dataset.glintbarTile, hasCard: Boolean(def?.Card || (def && needsConnection(def))) };
}

async function setDock(ids: string[]) {
  const known = ids.filter(isKnownWidget);
  await loadWidgets(known);
  useDock.setState({ instances: known.map((id, i) => ({ instanceId: id + "#smoke" + i, widgetId: id, config: {} })) });
  batchStart = Date.now();
  return { set: known, unknown: ids.filter((id) => !isKnownWidget(id)) };
}

export async function runCommand(cmd: Command): Promise<unknown> {
  const a = cmd.args;
  switch (cmd.action) {
    case "ping":
      return { at: Date.now() };
    case "setTheme": {
      const theme = (arg<string>(a, "theme") ?? a) as ThemeId;
      if (!THEMES.includes(theme)) throw new Error("unknown theme " + String(theme));
      updateSettings({ theme });
      return { theme };
    }
    case "setEdge": {
      const edge = (arg<string>(a, "edge") ?? a) as Edge;
      if (edge !== "top" && edge !== "bottom") throw new Error("edge must be top or bottom");
      dockActions.update({ edge });
      return { edge };
    }
    case "setSize": {
      const size = (arg<string>(a, "size") ?? a) as keyof typeof SIZE_PRESETS;
      const px = SIZE_PRESETS[size];
      if (!px) throw new Error("size must be s, m or l");
      // As in Settings > Dock: the size as drawn on this screen.
      editDockMeasures({ sizePreset: size, sizePx: px });
      return { size, px };
    }
    case "setFullWidth": {
      const on = Boolean(arg<boolean>(a, "fullWidth") ?? a);
      dockActions.update({ fullWidth: on, barWidth: 0 });
      return { fullWidth: on };
    }
    case "openCard":
      return openCard(String(arg<string>(a, "widgetId") ?? a));
    case "openPanel": {
      const panel = (arg<string>(a, "panel") ?? a) as PanelId;
      if (panel !== "widgets" && panel !== "settings") throw new Error("panel must be widgets or settings");
      ui.openPanel(panel, arg<string>(a, "section"));
      return { panel, section: useDockUi.getState().settingsSection };
    }
    case "closeAll":
      ui.closeAll();
      return { closed: true };
    case "addWidget": {
      const id = String(arg<string>(a, "widgetId") ?? a);
      if (!isKnownWidget(id)) throw new Error("unknown widget " + id);
      await loadWidget(id);
      if (!useDock.getState().instances.some((i) => i.widgetId === id)) dockActions.add(id);
      return { widgetId: id, instances: useDock.getState().instances.length };
    }
    case "setDock": {
      const ids = (arg<string[]>(a, "widgetIds") ?? a) as string[];
      if (!Array.isArray(ids)) throw new Error("setDock needs a list of widget ids");
      return setDock(ids);
    }
    case "restoreDock":
      if (originalDock) useDock.setState({ instances: originalDock });
      return { instances: useDock.getState().instances.length };
    case "listWidgets": {
      await loadAllWidgets();
      return widgetIds.map((id) => {
        const def = getWidget(id);
        return { id, size: def?.size ?? null, fit: def?.fit ?? null, hasCard: Boolean(def?.Card), account: def ? needsConnection(def) : false };
      });
    }
    case "planBatches": {
      await loadAllWidgets();
      const maxWidth = Number(arg<number>(a, "maxWidth")) || window.innerWidth - 120;
      return planBatches(maxWidth);
    }
    case "tileStatus":
      return recordTiles(String(arg<string>(a, "batch") ?? "?"), batchStart);
    case "dumpLayout":
      return dumpLayout("command");
    case "runSelftest":
      return runSelftest({ listenMs: Number(arg<number>(a, "listenMs")) || undefined });
    case "blocked":
      return call<string[]>("smoke", "blocked");
    case "quiet": {
      // The result is written first; polling resumes when the window ends (see startCommandChannel).
      const seconds = Math.max(0, Math.min(120, Number(arg<number>(a, "seconds") ?? a) || 0));
      quietFor(seconds * 1000);
      return { seconds };
    }
    // Round two (probes.ts): focus/typing, Apps tile, dock order, auto-hide, taskbar, live glass.
    case "focusInfo":
      return probes.focusInfo();
    case "todos":
      return probes.todos();
    case "todosRemove":
      return probes.todosRemove(a);
    case "dockOrder":
      return probes.dockOrder();
    case "reorderDock":
      return probes.reorderDock(a);
    case "setDockPrefs":
      return probes.setDockPrefs(a);
    case "setAutoHide":
      return probes.setAutoHide(a);
    // Round three: full-width alignment, magnification.
    case "setAlign":
      return probes.setAlign(a);
    case "magnifyState":
      return probes.magnifyState();
    case "shellState":
      return probes.shellState();
    case "appsState":
      return probes.appsState();
    case "appsSetPins":
      return probes.appsSetPins(a);
    case "appsAddPin":
      return probes.appsAddPin(a);
    case "appsClosePopup":
      return probes.appsClosePopup();
    case "allowLaunch":
      return probes.allowLaunch(a);
    case "glassStart":
      return probes.glassStart(a);
    case "glassStats":
      return probes.glassStats(a);
    case "glassStop":
      return probes.glassStop();
    case "quit":
      // Normal exit path (RunEvent::Exit cleanup restores the taskbar). Answer first.
      setTimeout(() => void call("app", "quit").catch(() => {}), 300);
      return { quitting: true };
    default:
      throw new Error("unknown action " + cmd.action);
  }
}

let lastId: string | null = null;
let busy = false;

async function pollOnce() {
  if (busy) return;
  busy = true;
  try {
    const text = await readSmokeFile("command.json").catch(() => null);
    if (!text) return;
    let cmd: Command;
    try {
      cmd = JSON.parse(text) as Command;
    } catch {
      return; // half-written; next poll
    }
    if (!cmd || typeof cmd.id !== "string" || cmd.id === lastId) return;
    lastId = cmd.id;
    const t0 = performance.now();
    let out: { id: string; action: string; ok: boolean; ms: number; result?: unknown; error?: string };
    try {
      const result = await runCommand(cmd);
      out = { id: cmd.id, action: cmd.action, ok: true, ms: Math.round(performance.now() - t0), result: result ?? null };
    } catch (e) {
      out = { id: cmd.id, action: cmd.action, ok: false, ms: Math.round(performance.now() - t0), error: formatValue(e).slice(0, 1000) };
    }
    await writeSmokeJson("command-result.json", out).catch(() => {});
  } finally {
    busy = false;
  }
}

let channelStarted = false;

export function startCommandChannel(): void {
  if (!originalDock) originalDock = useDock.getState().instances;
  if (channelStarted) return;
  channelStarted = true;
  // A timeout chain rather than an interval: during a "quiet" window it sleeps right through.
  const next = () => {
    setTimeout(() => {
      if (quietLeft() > 0) return next();
      void pollOnce().finally(next);
    }, Math.max(300, quietLeft()));
  };
  next();
}
