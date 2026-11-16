/** Browser preview only (?automations=1, &alert=1): the Settings page standalone, and a test alert. */
import { createRoot } from "react-dom/client";
import { AutomationsSettings } from "./AutomationsSettings";
import { testAlert } from "./engine";

export function mountDevPanel(): void {
  const el = document.createElement("div");
  document.body.appendChild(el);
  createRoot(el).render(
    <div className="g-panel pointer-events-auto fixed top-4 left-4 z-50 max-h-[calc(100vh-120px)] w-[560px] overflow-y-auto p-5 text-fg">
      <h2 className="mb-2 text-[16px] font-semibold">Automations</h2>
      <AutomationsSettings />
    </div>,
  );
  if (new URLSearchParams(location.search).get("alert") === "1") setTimeout(testAlert, 800);
}
