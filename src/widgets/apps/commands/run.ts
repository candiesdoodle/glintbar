import { call } from "../../../core/backend";
import { launchEntry, openTarget } from "../shared/actions";
import type { Match } from "./catalog";

export function runMatch(m: Match, isSample: boolean): void {
  if (isSample) return;
  if (m.kind === "app") {
    launchEntry(m.app);
    return;
  }
  const r = m.command.run;
  if ("open" in r) openTarget(r.open);
  else if ("shell" in r) call("shell", "run", { command: r.shell }).catch((e) => console.warn("command failed", e));
  else call(r.call[0], r.call[1]).catch((e) => console.warn("command failed", e));
}
