/**
 * Which dock window this page runs in: "main", or "dock-..." for the extra docks Displays = All
 * opens on other monitors. Every per-window shell call passes it.
 */
interface TauriMeta {
  __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
}

function readLabel(): string {
  try {
    const label = (globalThis as unknown as TauriMeta).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return typeof label === "string" && label ? label : "main";
  } catch {
    return "main";
  }
}

export const WINDOW_LABEL: string = readLabel();
export const isMainWindow: boolean = WINDOW_LABEL === "main";
