/**
 * Is this run driven by the CI smoke harness? Rust answers `smoke.status` (GLINTBAR_SMOKE=1); the
 * browser preview uses `?smoke=1` with an in-memory mock (src/smoke/mock.ts). Tiny on purpose:
 * main.tsx imports only this; the harness itself (src/smoke/index.ts) is a separate chunk.
 */
import { call, isTauri } from "../core/backend";
import { isMainWindow } from "../core/windowLabel";

export interface SmokeStatus {
  enabled: boolean;
  noCaptureExclude: boolean;
  dir: string;
  pid: number;
}

export async function detectSmoke(): Promise<SmokeStatus | null> {
  if (!isMainWindow) return null;
  try {
    if (!isTauri) {
      if (new URLSearchParams(location.search).get("smoke") !== "1") return null;
      await import("./mock");
    }
    const s = await call<SmokeStatus>("smoke", "status");
    return s && s.enabled ? s : null;
  } catch {
    // An older build without smoke.status, or no backend: not a smoke run.
    return null;
  }
}
