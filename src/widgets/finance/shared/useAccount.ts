import { useMemo } from "react";
import { liveCtx, type Account, type Ctx } from "./account";
import { usePolled, type Polled } from "./poll";

/** Sample data until connected, then `load` polled every `refreshMs` (shared across tiles by key). */
export function useAccountData<T>(
  acc: Pick<Account, "ns">,
  isSample: boolean,
  load: (ctx: Ctx) => Promise<T>,
  sample: () => T,
  opts: { refreshMs: number; key?: string; persist?: boolean },
): { data: T | undefined; poll: Polled<T> } {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => (isSample ? sample() : undefined), [isSample]);
  const poll = usePolled<T>(isSample ? null : `${acc.ns}:${opts.key ?? "data"}`, () => load(liveCtx(acc)), { refreshMs: opts.refreshMs, persist: opts.persist });
  return { data: isSample ? s : poll.data, poll };
}
