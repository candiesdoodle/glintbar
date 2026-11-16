import { History } from "lucide-react";
import { relativeTime } from "../../../core/format";
import type { TileProps } from "../../../core/widget";
import { TileFrame, TileSampleBadge } from "../../../ui";
import { openTarget } from "../shared/actions";
import { AppIcon } from "../shared/AppIcon";
import { useRecent, type RecentConfig } from "./shared";

export function RecentTile({ size, isSample }: TileProps<RecentConfig>) {
  const recent = useRecent(isSample);
  const items = (recent.data?.files.length ? recent.data.files : (recent.data?.apps ?? [])).slice(0, 2);
  const icon = Math.round(size * 0.5);
  const first = items[0];
  const small = Math.max(9, Math.round(size * 0.22));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.14)]" title="Recently opened">
      {items.length === 0 ? (
        <>
          <History size={icon} className="shrink-0 text-dim" />
          <div className="min-w-0 leading-tight">
            <div className="text-dim" style={{ fontSize: small }}>
              Recent
            </div>
            <div className="truncate text-fg" style={{ fontSize: small + 1 }}>
              {recent.error ? "Unavailable" : recent.loading ? "…" : "Nothing yet"}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex shrink-0 items-center" style={{ gap: Math.round(size * 0.06) }}>
            {items.map((it) => (
              <button
                key={it.target}
                type="button"
                title={it.name}
                className="g-press grid place-items-center rounded-md hover:bg-hover"
                style={{ width: icon + 4, height: icon + 4 }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSample) openTarget(it.target);
                }}
              >
                <AppIcon source={it.icon} name={it.name} kind={it.kind} size={icon} />
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-medium text-fg" style={{ fontSize: small + 1 }}>
              {first?.name}
            </div>
            <div className="truncate text-dim" style={{ fontSize: small }}>
              {first ? relativeTime(first.at) : ""}
            </div>
          </div>
        </>
      )}
      {isSample && <TileSampleBadge />}
    </TileFrame>
  );
}
