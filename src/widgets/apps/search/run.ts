import { openTarget } from "../shared/actions";
import { intentFor, type Engine } from "./logic";

/** Runs what was typed; returns the new history. */
export function runSearch(text: string, engine: Engine, history: string[], isSample: boolean): string[] | null {
  const intent = intentFor(text, engine);
  if (!intent) return null;
  if (!isSample) openTarget(intent.target);
  const t = text.trim();
  return [t, ...history.filter((h) => h !== t)].slice(0, 8);
}
