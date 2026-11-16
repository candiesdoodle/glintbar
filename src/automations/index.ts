/**
 * Automations: a local rules engine, quiet hours, alert sounds and the in-dock alerts.
 *
 * For other slices:
 * - `notify({ kind, title, body, actions })` shows an alert (held during quiet hours).
 * - `reportAiLimits(source, [...])` / `reportReviewRequests(source, [...])` feed the rules.
 * - Dated items (renewals, payouts, limit resets) go to the calendar registry:
 *   `calendarSources` in src/widgets/productivity/calendar/sources.ts.
 * For the shell: `AutomationsSettings` is the Settings > Automations page. The alert host mounts
 * itself; `AlertHost` is exported in case the dock wants to render it in its own tree.
 */
import { isTauri } from "../core/backend";
import { runsBackground } from "../widgets/productivity/shared/env";
import { mountAlertHost } from "./AlertHost";
import { startEngine } from "./engine";

export { notify, dismissAlert, dismissKey, useAlerts, type AlertInput, type AlertAction } from "./alerts";
export { AlertHost } from "./AlertHost";
export { AutomationsSettings } from "./AutomationsSettings";
export { reportAiLimits, reportReviewRequests, type AiLimitSignal, type ReviewRequestSignal } from "./signals";
export { playSound, SOUNDS, type SoundId } from "./sounds";
export { useAutomations, inQuietHours } from "./settings";

let started = false;

export function startAutomations(): void {
  if (started || !runsBackground) return;
  started = true;
  mountAlertHost();
  startEngine();
  if (!isTauri && typeof location !== "undefined" && new URLSearchParams(location.search).get("automations") === "1") {
    void import("./DevPanel").then((m) => m.mountDevPanel());
  }
}
