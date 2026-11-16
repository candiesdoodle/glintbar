import { useTopic } from "../../../core/backend";
import type { WindowInfo } from "../types";
import { sampleWindows } from "./sample";

const SAMPLE = sampleWindows();
const NONE: WindowInfo[] = [];

/** The open windows, live (Rust watches window events only while some tile listens). */
export function useWindows(isSample: boolean, enabled = true): WindowInfo[] | undefined {
  const live = useTopic<WindowInfo[]>("apps", "windows", { enabled: !isSample && enabled });
  if (isSample) return SAMPLE;
  return enabled ? live : NONE;
}
