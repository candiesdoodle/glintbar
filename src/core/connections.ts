/**
 * Which account widgets are connected. A widget with `connect` or `Connect` shows sample data
 * (`isSample`) until it is marked connected here.
 */
import { createPersistedStore } from "./store";
import { secrets, widgetSecretKey } from "./secrets";
import type { WidgetDef } from "./widget";

interface ConnectionsState {
  connected: Record<string, boolean>;
}

export const useConnections = createPersistedStore<ConnectionsState>("connections", { connected: {} });

export function needsConnection(def: Pick<WidgetDef, "connect" | "Connect">): boolean {
  return Boolean(def.connect || def.Connect);
}

export function isConnected(widgetId: string): boolean {
  return Boolean(useConnections.getState().connected[widgetId]);
}

export function setConnected(widgetId: string, connected: boolean): void {
  useConnections.setState((s) => ({ connected: { ...s.connected, [widgetId]: connected } }));
}

export function useIsConnected(widgetId: string): boolean {
  return useConnections((s) => Boolean(s.connected[widgetId]));
}

/** True when the widget needs an account and is not connected. */
export function useIsSample(def: Pick<WidgetDef, "id" | "connect" | "Connect">): boolean {
  const connected = useIsConnected(def.id);
  return needsConnection(def) && !connected;
}

/** Forgets the widget's stored keys and returns it to sample mode. */
export async function disconnect(def: Pick<WidgetDef, "id" | "connect">): Promise<void> {
  for (const f of def.connect?.fields ?? []) {
    if (f.secret) await secrets.delete(widgetSecretKey(def.id, f.key)).catch(() => {});
  }
  setConnected(def.id, false);
}
