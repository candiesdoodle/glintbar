import { ExternalLink, FolderOpen, History } from "lucide-react";
import { relativeTime } from "../../../core/format";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, EmptyState, ErrorState, IconButton, Segmented, Skeleton } from "../../../ui";
import { openTarget, reveal } from "../shared/actions";
import { AppIcon } from "../shared/AppIcon";
import type { RecentItem } from "../types";
import { folderOf, useRecent, type RecentConfig } from "./shared";

function Row({ it, isSample }: { it: RecentItem; isSample: boolean }) {
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => !isSample && openTarget(it.target)}>
        <AppIcon source={it.icon} name={it.name} kind={it.kind} size={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-fg">{it.name}</div>
          <div className="truncate text-[11px] text-dim">
            {relativeTime(it.at)}
            {it.kind !== "app" && <> · {folderOf(it.target)}</>}
          </div>
        </div>
      </button>
      {it.kind !== "app" && (
        <IconButton icon={FolderOpen} label="Show in folder" size={14} className="opacity-0 group-hover:opacity-100" onClick={() => !isSample && reveal(it.target)} />
      )}
    </div>
  );
}

export function RecentCard({ config, setConfig, isSample }: CardProps<RecentConfig>) {
  const recent = useRecent(isSample);
  const list = (config.tab === "apps" ? recent.data?.apps : recent.data?.files) ?? [];
  return (
    <CardFrame
      title="Recently Opened"
      subtitle={config.tab === "apps" ? "Most recently launched apps" : "Most recently opened files and folders"}
      icon={History}
      actions={
        <Segmented
          value={config.tab}
          onChange={(tab) => setConfig({ tab })}
          options={[
            { value: "files", label: "Files" },
            { value: "apps", label: "Apps" },
          ]}
        />
      }
      footer={
        <Button size="sm" icon={ExternalLink} onClick={() => !isSample && openTarget("shell:recent")}>
          Open the Recent folder
        </Button>
      }
    >
      {recent.error && !recent.data && <ErrorState message="Your recent items couldn't be loaded." onRetry={recent.refresh} />}
      {!recent.data && !recent.error && (
        <div className="space-y-2.5 py-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {recent.data && list.length === 0 && (
        <EmptyState icon={History} title="No recent items" message={config.tab === "apps" ? "Launch an app from Start or the dock and it will appear in this list." : "Open a file and it will appear in this list."} />
      )}
      <div className="-mx-2">
        {list.map((it) => (
          <Row key={it.target + it.at} it={it} isSample={isSample} />
        ))}
      </div>
    </CardFrame>
  );
}
