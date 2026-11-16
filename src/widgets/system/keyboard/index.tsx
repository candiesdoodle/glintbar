import { Keyboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { call, useService } from "../../../core/backend";
import { defineWidget, type TileProps } from "../../../core/widget";
import { ActionTile } from "../shared/ActionTile";

function KeyboardTile({ size, isSample }: TileProps) {
  const svc = useService<boolean>("system", "keyboard_state", undefined, { refreshMs: 3000 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (svc.data !== undefined) setOpen(svc.data);
  }, [svc.data, svc.updatedAt]);
  const toggle = useCallback(() => {
    if (busy) return;
    setBusy(true);
    call<boolean>("system", "keyboard_toggle")
      .then((now) => setOpen(!!now))
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        setTimeout(svc.refresh, 800);
      });
  }, [busy, svc.refresh]);
  return (
    <ActionTile
      size={size}
      isSample={isSample}
      icon={Keyboard}
      active={open}
      busy={busy}
      title={open ? "On-screen keyboard showing · click to hide" : "Show the on-screen keyboard"}
      onAction={toggle}
    />
  );
}

export default defineWidget({
  id: "system.keyboard",
  name: "Keyboard",
  category: "System",
  description: "A one-click switch that shows or hides Windows' on-screen keyboard.",
  keywords: ["on-screen keyboard", "osk", "touch", "type", "accessibility"],
  icon: Keyboard,
  size: "s",
  Tile: KeyboardTile,
});
