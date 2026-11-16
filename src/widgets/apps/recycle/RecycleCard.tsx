import { FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { call } from "../../../core/backend";
import { bytes } from "../../../core/format";
import { describeError } from "../../../core/http";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, ErrorState, Stat } from "../../../ui";
import { openTarget } from "../shared/actions";
import { BinArt, fullness, useBin } from "./shared";

export function RecycleCard({ isSample }: CardProps) {
  const bin = useBin(isSample);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError(null);
    call("apps", "recycle_empty")
      .then(() => setConfirm(false))
      .catch((e) => setError(describeError(e) === "An unexpected error occurred." ? "The Recycle Bin wasn't emptied. Another program may still be using one of the files." : describeError(e)))
      .finally(() => setBusy(false));
  };
  const count = bin?.count ?? 0;
  return (
    <CardFrame
      title="Recycle Bin"
      subtitle="Drag files onto the tile to send them here"
      icon={Trash2}
      footer={
        <>
          <Button size="sm" icon={FolderOpen} onClick={() => !isSample && openTarget("shell:RecycleBinFolder")}>
            Open
          </Button>
          <div className="flex-1" />
          {confirm && !busy && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          )}
          <Button size="sm" variant="danger" icon={Trash2} disabled={isSample || busy || count === 0} onClick={empty}>
            {busy ? "Emptying…" : confirm ? `Permanently delete ${count}` : "Empty"}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4 py-1">
        <BinArt size={64} fill={fullness(bin)} />
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Stat label="Items" value={bin ? count.toLocaleString() : "–"} />
          <Stat label="Size" value={bin ? bytes(bin.bytes) : "–"} />
        </div>
      </div>
      {confirm && !busy && <p className="mt-2 text-[12px] leading-snug text-warn">These items can't be restored once emptied. Click the button again to go ahead.</p>}
      {count === 0 && bin && <p className="mt-2 text-[12px] text-dim">No items in the Recycle Bin.</p>}
      {error && <ErrorState className="mt-2" message={error} />}
    </CardFrame>
  );
}
