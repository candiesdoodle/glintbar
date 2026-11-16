import { Plus } from "lucide-react";
import { useMemo, useRef } from "react";
import type { TileProps } from "../../../core/widget";
import { TileFrame, TileSampleBadge } from "../../../ui";
import { AppVisual } from "../apps/AppVisual";
import { StackPanel } from "../apps/StackPanel";
import { activate } from "../shared/actions";
import { buildDockApps } from "../shared/grouping";
import { anchorOf, closePopup, openPopup, usePopup } from "../shared/popups";
import { SAMPLE_DOWNLOADS } from "../shared/sample";
import { useWindows } from "../shared/useWindows";
import type { ShortcutConfig } from "./index";

export function ShortcutTile({ instanceId, config, size, openCard, isSample }: TileProps<ShortcutConfig>) {
  const entry = isSample ? SAMPLE_DOWNLOADS : config.entry;
  const root = useRef<HTMLDivElement>(null);
  const windows = useWindows(isSample, !!entry && entry.kind !== "file");
  const app = useMemo(() => (entry ? buildDockApps([entry], windows ?? [], { showRunning: false })[0] : undefined), [entry, windows]);
  const popup = usePopup((s) => (s.open?.owner === instanceId ? s.open : null));
  if (!entry || !app) {
    return (
      <TileFrame padded={false} className="justify-center text-dim" title="No app or folder set yet">
        <Plus size={Math.round(size * 0.42)} />
      </TileFrame>
    );
  }
  const m = { height: size, slot: size, icon: Math.round(size * 0.62), gap: 0, pad: 0 };
  return (
    <div
      ref={root}
      className="relative h-full w-full"
      title={app.name}
      onClick={(e) => {
        if (isSample) return;
        e.stopPropagation();
        if (popup) {
          closePopup();
          return;
        }
        if (activate(app) === "stack") openPopup({ kind: "stack", owner: instanceId, key: app.key, anchor: anchorOf(root.current) });
      }}
      onContextMenu={(e) => {
        if (isSample) return;
        // Right-click: change what it opens.
        e.preventDefault();
        e.stopPropagation();
        openCard();
      }}
    >
      <AppVisual app={app} m={m} style="cards" css={{ width: "100%", height: "100%" }} />
      {isSample && <TileSampleBadge />}
      {popup?.kind === "stack" && <StackPanel entry={entry} anchor={popup.anchor} keepOpenOn={() => root.current} />}
    </div>
  );
}
