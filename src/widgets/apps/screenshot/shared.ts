import { create } from "zustand";
import { call } from "../../../core/backend";
import type { WidgetConfig } from "../../../core/widget";
import type { Capture } from "../types";

export type CaptureMode = "screen" | "window" | "region";

export interface ScreenshotConfig extends WidgetConfig {
  save: boolean;
  clipboard: boolean;
  /** Seconds to wait before taking it. */
  delay: number;
  /** Empty = Pictures\\Screenshots. */
  folder: string;
}

export const DEFAULT_SHOT: ScreenshotConfig = { save: true, clipboard: true, delay: 0, folder: "" };

interface ShotState {
  last: Capture | null;
  busy: CaptureMode | null;
  error: string | null;
  /** Bumps on every new shot (tile flash). */
  seq: number;
}

export const useShots = create<ShotState>()(() => ({ last: null, busy: null, error: null, seq: 0 }));

export async function capture(mode: CaptureMode, cfg: ScreenshotConfig, isSample: boolean): Promise<void> {
  if (isSample || useShots.getState().busy) return;
  if (mode === "region") {
    // Windows' own snipping overlay: drag a box, it lands on the clipboard.
    await call("apps", "capture_region").catch(() => useShots.setState({ error: "The Windows snipping overlay did not start." }));
    return;
  }
  useShots.setState({ busy: mode, error: null });
  try {
    const shot = await call<Capture>("apps", "capture", {
      mode,
      save: cfg.save,
      clipboard: cfg.clipboard || !cfg.save,
      folder: cfg.folder || undefined,
      delayMs: Math.round(cfg.delay * 1000),
    });
    useShots.setState((s) => ({ last: shot, busy: null, seq: s.seq + 1 }));
  } catch {
    useShots.setState({ busy: null, error: "GlintBar couldn't take that screenshot. Try once more." });
  }
}

export function fileName(path: string | null): string {
  if (!path) return "";
  const i = path.lastIndexOf("\\");
  return i >= 0 ? path.slice(i + 1) : path;
}
