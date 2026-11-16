import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { startAutomations } from "./automations";
import { call, isTauri, resetSubscriptions } from "./core/backend";
import { loadBackground } from "./core/background";
import { loadMocks } from "./core/mock";
import { loadWidgets } from "./core/registry";
import { loadStore } from "./core/store";
import { applyDevParams } from "./dock/devParams";
import { useDock } from "./dock/layout";
import { installFocusHandling } from "./dock/overlay";
import { detectSmoke } from "./smoke/detect";

async function boot() {
  if (!isTauri) {
    document.body.classList.add("glintbar-preview");
    await loadMocks();
  }
  // CI smoke harness (GLINTBAR_SMOKE=1, or ?smoke=1 in the browser): its code loads only then.
  const smoke = await detectSmoke();
  const harness = smoke ? await import("./smoke") : null;
  harness?.installCapture();
  await resetSubscriptions();
  await loadStore();
  if (!isTauri) await applyDevParams();
  // Widgets are split per folder: fetch the ones on the dock before the first paint, so the bar
  // comes up complete. Everything else (picker, Settings, cards) loads on first use.
  await loadWidgets(useDock.getState().instances.map((i) => i.widgetId));
  installFocusHandling();
  void loadBackground();
  startAutomations();

  // No browser context menu inside the dock (the dock has its own); text fields keep theirs.
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
  });
  window.addEventListener("error", (e) => {
    call("app", "log", { level: "error", message: `${e.message} at ${e.filename}:${e.lineno}` }).catch(() => {});
  });
  window.addEventListener("unhandledrejection", (e) => {
    call("app", "log", { level: "warn", message: `unhandled: ${String(e.reason)}` }).catch(() => {});
  });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  call("app", "log", { level: "info", message: "ui ready" }).catch(() => {});
  if (harness && smoke) harness.start(smoke);
}

void boot();
