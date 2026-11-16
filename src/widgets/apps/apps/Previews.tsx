import { X } from "lucide-react";
import { useService } from "../../../core/backend";
import type { Anchor } from "../../../dock/ui";
import { Spinner } from "../../../ui";
import { closeWindow, focusWindow } from "../shared/actions";
import { AppIcon } from "../shared/AppIcon";
import type { DockApp } from "../shared/grouping";
import { FloatingPanel, usePopup } from "../shared/popups";
import type { WindowInfo } from "../types";

const THUMB_W = 208;

function WindowCard({ w, icon, name }: { w: WindowInfo; icon: string; name: string }) {
  // Refreshes every 2 s while the previews are open (Rust throttles the captures too).
  const shot = useService<string | null>("apps", "preview", { hwnd: w.hwnd, width: THUMB_W * 2 }, { refreshMs: 2000, enabled: !w.minimized });
  return (
    <div
      role="button"
      tabIndex={0}
      className="group g-press flex w-[208px] shrink-0 cursor-default flex-col gap-1.5 rounded-xl p-1.5 text-left hover:bg-hover"
      onClick={() => {
        usePopup.setState({ open: null });
        focusWindow(w);
      }}
    >
      <div className="flex items-center gap-1.5 px-0.5">
        <AppIcon source={icon} name={name} size={14} />
        <div className="min-w-0 flex-1 truncate text-[11.5px] text-fg">{w.title || name}</div>
        <button
          type="button"
          aria-label="Close window"
          title="Close window"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-dim opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bad hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            closeWindow(w);
          }}
        >
          <X size={12} />
        </button>
      </div>
      <div className="grid h-[124px] place-items-center overflow-hidden rounded-lg bg-input">
        {w.minimized || shot.data === null ? (
          <div className="flex flex-col items-center gap-1.5 text-[11px] text-faint">
            <AppIcon source={icon} name={name} size={30} />
            {w.minimized ? "Minimized" : "No preview"}
          </div>
        ) : shot.data ? (
          <img src={shot.data} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
        ) : (
          <Spinner />
        )}
      </div>
    </div>
  );
}

/** Live pictures of an app's windows, each with its title and a close button. */
export function Previews({ app, anchor, onEnter, onLeave }: { app: DockApp; anchor: Anchor; onEnter: () => void; onLeave: () => void }) {
  const wins = [...app.windows].sort((a, b) => a.hwnd - b.hwnd).slice(0, 8);
  const cols = Math.min(4, wins.length);
  return (
    <FloatingPanel id="apps-preview" anchor={anchor} width={cols * (THUMB_W + 4) + 12} className="p-1.5">
      <div className="flex flex-wrap gap-1" onPointerEnter={onEnter} onPointerLeave={onLeave}>
        {wins.map((w) => (
          <WindowCard key={w.hwnd} w={w} icon={app.icon} name={app.name} />
        ))}
      </div>
    </FloatingPanel>
  );
}
