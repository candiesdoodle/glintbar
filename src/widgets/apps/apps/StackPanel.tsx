import { FolderOpen } from "lucide-react";
import { useService } from "../../../core/backend";
import { relativeTime } from "../../../core/format";
import type { Anchor } from "../../../dock/ui";
import { Button, ErrorState, Spinner } from "../../../ui";
import { launchEntry, openTarget } from "../shared/actions";
import { AppIcon } from "../shared/AppIcon";
import { FloatingPanel, usePopup } from "../shared/popups";
import type { AppEntry, FolderEntry } from "../types";

/** A folder on the dock opens as a stack: what's inside, folders first, newest first. */
export function StackPanel({ entry, anchor, keepOpenOn }: { entry: AppEntry; anchor: Anchor; keepOpenOn?: () => Element | null }) {
  const list = useService<FolderEntry[]>("apps", "list_folder", { path: entry.target, limit: 40 });
  const items = list.data ?? [];
  const close = () => usePopup.setState({ open: null });
  return (
    <FloatingPanel id="apps-stack" anchor={anchor} width={372} maxHeight={460} keepOpenOn={keepOpenOn} className="flex flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <AppIcon source={entry.icon} name={entry.name} kind="folder" size={18} />
        <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{entry.name}</div>
        {list.data && <div className="text-[11px] text-faint">{items.length === 40 ? "40+" : items.length} items</div>}
      </div>
      <div className="g-scroll-y min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.error && !list.data && <ErrorState className="m-2" message="GlintBar can't open this folder. Check whether it was moved or deleted." onRetry={list.refresh} />}
        {!list.data && !list.error && (
          <div className="grid h-24 place-items-center">
            <Spinner />
          </div>
        )}
        {list.data && items.length === 0 && <div className="py-8 text-center text-[12px] text-dim">No files in this folder.</div>}
        <div className="grid grid-cols-4 gap-1">
          {items.map((it) => (
            <button
              key={it.path}
              type="button"
              title={`${it.name}\n${relativeTime(it.modified)}`}
              className="g-press flex flex-col items-center gap-1 rounded-lg px-1 py-2 hover:bg-hover"
              onClick={() => {
                close();
                openTarget(it.path);
              }}
            >
              <AppIcon source={it.icon} name={it.name} kind={it.isDir ? "folder" : "file"} size={40} />
              <span className="line-clamp-2 w-full text-center text-[11px] leading-tight break-words text-fg">{it.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-card-line px-3 py-2">
        <Button
          size="sm"
          icon={FolderOpen}
          onClick={() => {
            close();
            launchEntry(entry);
          }}
        >
          Open in File Explorer
        </Button>
      </div>
    </FloatingPanel>
  );
}
