import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bell, X } from "lucide-react";
import { stripThickness, useDock } from "../dock/layout";
import { POPOVER_GAP, useOverlaySize } from "../dock/overlay";
import { cx } from "../ui/cx";
import { dismissAlert, useAlerts, type Alert } from "./alerts";

const AUTO_HIDE_MS = 9000;

/** Only one host renders, even if the shell also mounts one. */
let owners = 0;

/** The toast stack at the right end of the dock. Mounted automatically (see `mountAlertHost`). */
export function AlertHost() {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (owners > 0) return;
    owners++;
    setOwner(true);
    return () => {
      owners--;
    };
  }, []);
  const shown = useAlerts((s) => s.shown);
  if (!owner || shown.length === 0) return null;
  return <Stack alerts={shown} />;
}

function Stack({ alerts }: { alerts: Alert[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const edge = useDock((s) => s.edge);
  const thickness = useDock(stripThickness);
  useOverlaySize("alerts", ref);
  return (
    <div
      ref={ref}
      data-glintbar-panel="alerts"
      className={cx("pointer-events-auto fixed right-3 z-40 flex w-[320px] max-w-[calc(100vw-24px)] gap-2", edge === "bottom" ? "flex-col-reverse" : "flex-col")}
      style={{ [edge === "bottom" ? "bottom" : "top"]: thickness + POPOVER_GAP }}
      role="status"
      aria-live="polite"
    >
      {[...alerts].reverse().map((a) => (
        <Toast key={a.id} alert={a} edge={edge} />
      ))}
    </div>
  );
}

function Toast({ alert, edge }: { alert: Alert; edge: "top" | "bottom" }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (alert.sticky || hover) return;
    const t = setTimeout(() => dismissAlert(alert.id), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [alert.id, alert.sticky, hover]);
  const Icon = alert.icon ?? Bell;
  return (
    <div
      className={cx("g-panel flex gap-3 p-3 text-fg", edge === "bottom" ? "g-pop-up" : "g-pop-down")}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[13px] leading-snug font-semibold">{alert.title}</div>
          <button type="button" aria-label="Dismiss" className="g-press -mt-0.5 -mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-dim hover:bg-hover hover:text-fg" onClick={() => dismissAlert(alert.id)}>
            <X size={14} />
          </button>
        </div>
        {alert.body && <div className="mt-0.5 text-[12px] leading-snug text-dim">{alert.body}</div>}
        {alert.actions && alert.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {alert.actions.map((act) => (
              <button
                key={act.label}
                type="button"
                className={cx("g-press h-7 rounded-lg px-2.5 text-[12px] font-medium", act.primary ? "bg-accent text-on-accent hover:brightness-110" : "bg-input text-fg hover:bg-hover")}
                onClick={() => {
                  dismissAlert(alert.id);
                  act.run();
                }}
              >
                {act.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

let mounted = false;

/** Renders the alert host in its own root next to the dock (idempotent). */
export function mountAlertHost(): void {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const start = () => {
    const el = document.createElement("div");
    el.id = "glintbar-alerts";
    document.body.appendChild(el);
    createRoot(el).render(<AlertHost />);
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
