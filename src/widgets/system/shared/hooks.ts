import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";
import { useTopic } from "../../../core/backend";
import { useDockUi } from "../../../dock/ui";
import type { BatteryState, MemorySample, ProcSample } from "./types";

/**
 * For tiles whose click does something (instead of opening a card): ignores clicks in the
 * widget picker preview, while the dock is being edited, and at the end of a drag.
 */
export function useTileAction(isSample: boolean, action: () => void) {
  const editing = useDockUi((s) => s.panel === "widgets");
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onClick = useCallback(
    (e: MouseEvent) => {
      if (isSample || editing) return;
      const d = down.current;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      action();
    },
    [isSample, editing, action],
  );
  return { onPointerDown, onClick };
}

/** Stops a control inside a tile from opening the card or starting a tile drag. */
export const insideTile = {
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onClick: (e: MouseEvent) => e.stopPropagation(),
};

export const useBattery = () => useTopic<BatteryState>("system", "battery");
export const useMemory = () => useTopic<MemorySample>("system", "memory");
export const useProcs = () => useTopic<ProcSample>("system", "procs");
