import { useCallback, useEffect, useState } from "react";
import { call, useService } from "../../../core/backend";
import { describeError } from "../../../core/http";
import type { ToggleResult, ToggleState } from "../shared/types";
import { viewOf, type ToggleId } from "./toggles";

/** Toggle state (refreshed every 5 s while visible) with optimistic flips. */
export function useToggles() {
  const svc = useService<ToggleState>("system", "toggles_state", undefined, { refreshMs: 5000 });
  const [override, setOverride] = useState<Partial<Record<ToggleId, boolean>>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<ToggleId | null>(null);

  // Fresh data from Windows wins over optimistic guesses.
  useEffect(() => setOverride({}), [svc.updatedAt]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const flip = useCallback(
    async (id: ToggleId, mode?: string) => {
      const v = viewOf(id, svc.data, override);
      const next = !v.on;
      if (!v.opensSettings && !v.action) setOverride((o) => ({ ...o, [id]: next }));
      setBusy(id);
      try {
        const r = await call<ToggleResult>("system", "toggle_set", { id, on: next, mode });
        if (r?.openedSettings) setNote(v.action ? "Choose a mode in the Windows display menu" : `Windows settings opened at ${v.label.toLowerCase()}`);
      } catch (e) {
        setNote(describeError(e));
        setOverride((o) => {
          const copy = { ...o };
          delete copy[id];
          return copy;
        });
      } finally {
        setBusy(null);
        setTimeout(svc.refresh, 700);
      }
    },
    [svc.data, svc.refresh, override],
  );

  return { state: svc.data, error: svc.error, loading: svc.loading, refresh: svc.refresh, override, flip, note, busy };
}
