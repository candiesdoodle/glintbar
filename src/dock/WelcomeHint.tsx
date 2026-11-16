/**
 * First run: a short note above the dock on where Widgets… and Settings are. Shown once (main
 * window only), gone as soon as it is dismissed or either panel is opened.
 */
import { useEffect } from "react";
import { LayoutGrid, MousePointerClick, Settings } from "lucide-react";
import { useStored } from "../core/store";
import { isMainWindow } from "../core/windowLabel";
import { Button } from "../ui/controls";
import { Popover } from "./Popover";
import { ui, useDockUi } from "./ui";

export const WELCOME_KEY = "shell.welcomeSeen";

export function WelcomeHint() {
  const [seen, setSeen] = useStored<boolean>(WELCOME_KEY, false);
  const panel = useDockUi((s) => s.panel);
  const busy = useDockUi((s) => Boolean(s.card || s.menu || s.hidden));
  useEffect(() => {
    if (panel && !seen) setSeen(true);
  }, [panel, seen, setSeen]);
  if (seen || !isMainWindow || panel || busy) return null;
  const done = (then?: () => void) => {
    setSeen(true);
    then?.();
  };
  return (
    <Popover id="welcome" anchor="center" width={380}>
      <div className="flex gap-3 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-on-accent">
          <MousePointerClick size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-fg">Welcome to GlintBar</div>
          <p className="mt-1 text-[12.5px] leading-snug text-dim">
            Click any widget for its details. Right-click the dock and choose <span className="text-fg">Widgets…</span> to add more, or <span className="text-fg">Settings</span> to
            change size, position and style. Drag a widget to move it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={LayoutGrid} onClick={() => done(() => ui.openPanel("widgets"))}>
              Widgets…
            </Button>
            <Button size="sm" variant="secondary" icon={Settings} onClick={() => done(() => ui.openPanel("settings"))}>
              Settings
            </Button>
            <Button size="sm" variant="ghost" onClick={() => done()}>
              Got it
            </Button>
          </div>
        </div>
      </div>
    </Popover>
  );
}
