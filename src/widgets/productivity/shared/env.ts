import { isMainWindow, WINDOW_LABEL } from "../../../core/windowLabel";

/** True under vitest: background loops (sync, schedulers, hotkeys) stay off in tests. */
export const isTest: boolean = import.meta.env?.MODE === "test";

/**
 * Background work (schedulers, calendar sync, the automations engine, alerts) runs once, in the
 * main dock window; extra docks on other monitors only render tiles.
 */
export const runsBackground: boolean = !isTest && isMainWindow;

export { WINDOW_LABEL };

let ids = 0;
/** Short unique ids for list items. */
export function uid(prefix = ""): string {
  ids = (ids + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${ids.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
