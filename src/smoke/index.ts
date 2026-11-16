/**
 * The CI smoke harness, loaded only when the app runs with GLINTBAR_SMOKE=1 (or ?smoke=1 in the
 * browser preview). See scripts/smoke/drive.ps1 for the other half.
 *
 * - console.json   every console error/warning, uncaught error and unhandled rejection
 * - layout.json    window, bar and tile rects in physical screen px (rewritten on change)
 * - command.json   -> command-result.json: the driver's command channel (commands.ts)
 * - selftest.json  every read-only service method and live topic, against the real backend
 * - tiles.json     render status of every widget, batch by batch
 */
import { call } from "../core/backend";
import { startCommandChannel } from "./commands";
import { consoleSnapshot, installConsoleCapture } from "./console";
import type { SmokeStatus } from "./detect";
import { writeSmokeJson, writeSoon } from "./io";
import { dumpLayout, installPointerCounter, watchLayout } from "./layout";

/** Before the first render, so start-up errors are captured too. */
export function installCapture(): void {
  installConsoleCapture();
  installPointerCounter();
}

/** After the dock has rendered. */
export function start(status: SmokeStatus): void {
  void writeSmokeJson("smoke-start.json", { at: new Date().toISOString(), status, userAgent: navigator.userAgent }).catch(() => {});
  call("app", "log", { level: "info", message: "smoke harness ready" }).catch(() => {});
  startCommandChannel();
  writeSoon("console.json", consoleSnapshot, 1500);
  // Give the bar a moment to lay out its tiles, then publish the first layout.
  setTimeout(() => {
    void dumpLayout("start");
    watchLayout();
  }, 800);
}
