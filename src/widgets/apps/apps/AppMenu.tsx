import { AppWindow, ExternalLink, FolderOpen, LayoutGrid, Pin, PinOff, Play, Settings, ShieldAlert, SlidersHorizontal, X } from "lucide-react";
import { useService } from "../../../core/backend";
import { ui } from "../../../dock/ui";
import type { Anchor } from "../../../dock/ui";
import { closeWindow, endTask, focusWindow, launchEntry, openTarget, relaunchTarget, reveal } from "../shared/actions";
import { AppIcon } from "../shared/AppIcon";
import type { DockApp } from "../shared/grouping";
import { FloatingPanel, MenuDivider, MenuHeading, MenuItem } from "../shared/popups";
import type { JumpItem, JumpList } from "../types";

function JumpRows({ title, items, app }: { title: string; items: JumpItem[]; app: DockApp }) {
  if (!items.length) return null;
  return (
    <>
      <MenuHeading>{title}</MenuHeading>
      {items.map((it) => (
        <MenuItem
          key={it.title + it.target + (it.args ?? "")}
          icon={<AppIcon source={it.icon || app.icon} name={it.title} size={15} kind="file" />}
          label={it.title}
          onSelect={() => openTarget(it.target, it.args)}
        />
      ))}
    </>
  );
}

/** An app's right-click menu: its jump list, its windows, pin, close, end task. */
export function AppMenu({
  app,
  anchor,
  pinned,
  isSample,
  onPin,
  onUnpin,
  onSettings,
  keepOpenOn,
}: {
  app: DockApp;
  anchor: Anchor;
  pinned: boolean;
  isSample: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onSettings: () => void;
  keepOpenOn: () => Element | null;
}) {
  const first = app.windows[0];
  const aumid = app.pin?.aumid ?? first?.aumid ?? undefined;
  const exe = app.pin?.exe ?? first?.exe ?? undefined;
  const jump = useService<JumpList>("apps", "jump_list", { aumid, exe, limit: 7 }, { enabled: !!(aumid || exe) && app.kind === "app" });
  const again = relaunchTarget(app);
  const location = app.pin?.kind === "folder" || app.pin?.kind === "file" ? app.pin.target : (exe ?? (app.pin?.target.includes(":\\") ? app.pin.target : undefined));
  const many = app.windows.length > 1;
  const j = jump.data;
  return (
    <FloatingPanel id="apps-menu" anchor={anchor} width={252} className="py-1" keepOpenOn={keepOpenOn}>
      <div className="g-scroll-y min-h-0 overflow-y-auto">
      <div className="flex items-center gap-2.5 px-3.5 pt-2 pb-1.5">
        <AppIcon source={app.icon || app.group?.items[0]?.icon} name={app.name} size={20} kind={app.kind === "group" ? "app" : app.kind} />
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{app.name}</div>
        {isSample && <span className="text-[10px] text-faint">Preview</span>}
      </div>
      {j && (
        <>
          <JumpRows title="Pinned" items={j.pinned} app={app} />
          <JumpRows title="Tasks" items={j.tasks} app={app} />
          <JumpRows title="Recent" items={j.recent} app={app} />
          {(j.pinned.length > 0 || j.tasks.length > 0 || j.recent.length > 0) && <MenuDivider />}
        </>
      )}
      {many && (
        <>
          <MenuHeading>Windows</MenuHeading>
          {app.windows.slice(0, 8).map((w) => (
            <MenuItem key={w.hwnd} icon={<AppWindow size={14} />} label={w.title || app.name} hint={w.minimized ? "minimized" : undefined} onSelect={() => focusWindow(w)} />
          ))}
          <MenuDivider />
        </>
      )}
      {again && app.kind !== "group" && (
        <MenuItem icon={<Play size={14} />} label={app.windows.length ? "Open new window" : "Open"} onSelect={() => launchEntry(again)} />
      )}
      {app.pin?.kind === "folder" && <MenuItem icon={<FolderOpen size={14} />} label="Open folder" onSelect={() => launchEntry(app.pin!)} />}
      {location && app.kind !== "group" && <MenuItem icon={<ExternalLink size={14} />} label="Open file location" onSelect={() => reveal(location)} />}
      {pinned ? (
        <MenuItem icon={<PinOff size={14} />} label={app.kind === "group" ? "Remove group from dock" : "Unpin from dock"} onSelect={onUnpin} />
      ) : (
        <MenuItem icon={<Pin size={14} />} label="Pin to dock" onSelect={onPin} />
      )}
      {app.windows.length > 0 && (
        <>
          <MenuDivider />
          <MenuItem icon={<X size={14} />} label={many ? `Close all ${app.windows.length} windows` : "Close window"} onSelect={() => app.windows.forEach(closeWindow)} />
          <MenuItem icon={<ShieldAlert size={14} />} label={app.hung ? "End task (not responding)" : "End task"} danger onSelect={() => endTask(app.windows)} />
        </>
      )}
      <MenuDivider />
      <MenuItem icon={<SlidersHorizontal size={14} />} label="Apps settings…" onSelect={onSettings} />
      <MenuItem icon={<LayoutGrid size={14} />} label="Widgets…" onSelect={() => ui.openPanel("widgets")} />
      <MenuItem icon={<Settings size={14} />} label="Settings" onSelect={() => ui.openPanel("settings")} />
      </div>
    </FloatingPanel>
  );
}
