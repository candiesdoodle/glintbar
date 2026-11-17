/**
 * Browser stand-in for the shell service's dock-window methods (the core mock in
 * src/core/mock.ts covers open/run/set_dock/set_overlay/set_focusable/show). Auto-hide and
 * dragging the dock behave like the real thing, driven by the page's own pointer events.
 */
import { mockEmit, mockService } from "../../core/mock";

type Visibility = "shown" | "autohidden" | "suppressed";

interface Geometry {
  edge?: "top" | "bottom";
  autoHide?: boolean;
  monitor?: string;
  displays?: string;
}

const MONITORS = [
  {
    id: "\\\\.\\DISPLAY1",
    primary: true,
    monitor: { left: 0, top: 0, right: 2560, bottom: 1440 },
    work: { left: 0, top: 0, right: 2560, bottom: 1440 },
    dpi: 144,
  },
  {
    id: "\\\\.\\DISPLAY2",
    primary: false,
    monitor: { left: 2560, top: 180, right: 4480, bottom: 1260 },
    work: { left: 2560, top: 180, right: 4480, bottom: 1260 },
    dpi: 96,
  },
];

let geo: Geometry = {};
let hover = false;
let popover = false;
let held = false;
let visibility: Visibility = "shown";
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function emitVisibility(next: Visibility) {
  if (next === visibility) return;
  visibility = next;
  mockEmit("shell", "visibility", { label: "main", state: next });
}

function evaluate() {
  clearTimeout(hideTimer);
  const up = !geo.autoHide || hover || popover || held;
  if (up) emitVisibility("shown");
  else if (visibility === "shown") hideTimer = setTimeout(() => emitVisibility("autohidden"), 650);
}

mockService("shell", {
  set_dock: (g: Geometry) => {
    geo = { ...g };
    evaluate();
  },
  set_overlay: ({ height }: { height: number }) => {
    popover = height > 0;
    evaluate();
  },
  set_hover: ({ inside }: { inside: boolean }) => {
    hover = inside;
    evaluate();
  },
  set_hit_rects: () => undefined,
  reveal: () => {
    held = true;
    evaluate();
    setTimeout(() => {
      held = false;
      evaluate();
    }, 2500);
  },
  begin_drag: () => {
    // The real one moves the window with the pointer; here the drop point decides the edge.
    const up = (e: PointerEvent) => {
      const edge = e.clientY < window.innerHeight / 2 ? "top" : "bottom";
      mockEmit("shell", "placement", { edge, monitor: geo.monitor ?? "", at: Date.now() });
    };
    window.addEventListener("pointerup", up, { once: true });
  },
  window_info: ({ label }: { label?: string }) => ({
    label: label ?? "main",
    monitor: MONITORS[0].id,
    primary: true,
    visibility,
    docks: 1,
  }),
  close_ready: () => undefined,
  monitors: () => MONITORS,
  hotkeys_set: ({ hotkeys }: { hotkeys: Array<{ id: string; keys: string }> }) =>
    (hotkeys ?? []).map((h) => ({ id: h.id, keys: h.keys, ok: true, error: null })),
  get_state: () => ({
    geometry: geo,
    docks: [{ label: "main", hwnd: 0, monitor: MONITORS[0].id, visibility, appBar: false, regionOk: true }],
    monitors: MONITORS,
    taskbarHidden: false,
  }),
});
