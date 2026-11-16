/** Removing a tile animates it away (it shrinks and the others close the gap), then drops it. */
import { create } from "zustand";
import { dockActions } from "./layout";

export const REMOVE_MS = 190;

export const useRemoving = create<{ ids: Record<string, true> }>()(() => ({ ids: {} }));

export function removeWithAnimation(instanceId: string): void {
  if (useRemoving.getState().ids[instanceId]) return;
  useRemoving.setState((s) => ({ ids: { ...s.ids, [instanceId]: true } }));
  setTimeout(() => {
    dockActions.remove(instanceId);
    useRemoving.setState((s) => {
      const ids = { ...s.ids };
      delete ids[instanceId];
      return { ids };
    });
  }, REMOVE_MS);
}
