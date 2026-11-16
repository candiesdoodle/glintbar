import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { call, useService } from "../../../core/backend";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ActionTile } from "../shared/ActionTile";
import type { ToggleResult } from "../shared/types";

function DndTile({ size, isSample }: TileProps) {
  const svc = useService<boolean | null>("system", "dnd_state", undefined, { refreshMs: 6000 });
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (svc.data !== undefined) setOn(svc.data);
  }, [svc.data, svc.updatedAt]);
  const toggle = useCallback(() => {
    if (busy) return;
    const next = !on;
    setBusy(true);
    if (on !== null) setOn(next);
    call<ToggleResult>("system", "toggle_set", { id: "dnd", on: next })
      .catch(() => setOn(on))
      .finally(() => {
        setBusy(false);
        setTimeout(svc.refresh, 500);
      });
  }, [on, busy, svc.refresh]);
  const active = on === true;
  return (
    <ActionTile
      size={size}
      isSample={isSample}
      icon={active ? BellOff : Bell}
      active={active}
      busy={busy}
      title={on === null ? "Do not disturb · opens in Windows settings" : active ? "Notifications held back · click to let them through" : "Notifications allowed · click to hold them back"}
      onAction={toggle}
    />
  );
}

export default defineWidget({
  id: "system.dnd",
  name: "Do Not Disturb",
  category: "System",
  description: "Switches Windows do not disturb on or off to hold back banners.",
  keywords: ["notifications", "focus", "quiet", "silence", "dnd"],
  icon: BellOff,
  size: "s",
  Tile: DndTile,
});
