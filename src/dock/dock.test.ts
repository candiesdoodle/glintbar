import { describe, expect, it } from "vitest";
import { toHitRect } from "./hitRegion";
import { DEFAULT_DOCK, minBarWidth, narrowedWidth, reorderFor, slotOffsets, type SlotRect } from "./layout";
import { geometryFor, taskbarChoice } from "./shell";
import { isPreciseWheel, wheelDelta } from "./wheel";

const rects = new Map<string, SlotRect>([
  ["a", { left: 0, width: 50 }],
  ["b", { left: 56, width: 100 }],
  ["c", { left: 162, width: 50 }],
]);
const order = ["a", "b", "c"];

describe("drag to reorder", () => {
  it("moves a tile past the centres it crosses", () => {
    expect(reorderFor(order, rects, "a", 0)).toEqual(["a", "b", "c"]);
    expect(reorderFor(order, rects, "a", 90)).toEqual(["b", "a", "c"]);
    expect(reorderFor(order, rects, "a", 200)).toEqual(["b", "c", "a"]);
    expect(reorderFor(order, rects, "c", -200)).toEqual(["c", "a", "b"]);
  });
  it("parts the other tiles by sliding them to their new slots", () => {
    const off = slotOffsets(order, ["b", "a", "c"], rects, 6);
    expect(off.get("b")).toBe(-56);
    expect(off.get("a")).toBe(106);
    expect(off.get("c")).toBe(0);
  });
  it("closes the gap of a tile lifted off the bar", () => {
    const off = slotOffsets(order, ["a", "c"], rects, 6);
    expect(off.get("c")).toBe(56 - 162);
    expect(off.has("b")).toBe(false);
  });
});

describe("narrowing the bar", () => {
  const min = minBarWidth(DEFAULT_DOCK);
  it("moves both ends of a centred bar", () => {
    expect(narrowedWidth(600, -50, "right", min, 600)).toBe(500);
    expect(narrowedWidth(600, 50, "left", min, 600)).toBe(500);
  });
  it("stops at one tile and returns to auto at the natural width", () => {
    expect(narrowedWidth(600, -1000, "right", min, 600)).toBe(min);
    expect(narrowedWidth(400, 200, "right", min, 600)).toBe(0);
  });
});

describe("hit rects", () => {
  it("measures panels from the screen edge", () => {
    const r = { left: 100, top: 300, width: 200, height: 100 };
    expect(toHitRect(r, "panel", 10, "bottom", 500, 64)).toEqual({ left: 90, width: 220, near: 90, far: 210 });
    expect(toHitRect(r, "panel", 0, "top", 500, 64)).toEqual({ left: 100, width: 200, near: 300, far: 400 });
  });
  it("gives the bar the whole strip height", () => {
    expect(toHitRect({ left: 10, top: 5, width: 50, height: 40 }, "bar", 0, "bottom", 64, 64)).toEqual({ left: 10, width: 50, near: 0, far: 64 });
  });
});

describe("wheel", () => {
  it("tells touchpads from wheels", () => {
    expect(isPreciseWheel({ deltaMode: 0, deltaX: 3, deltaY: 1 })).toBe(true);
    expect(isPreciseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(false);
    expect(isPreciseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(false);
    expect(wheelDelta({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 800)).toBe(120);
  });
});

describe("geometry sent to Rust", () => {
  it("maps the taskbar choice, old layouts included", () => {
    expect(taskbarChoice(true, "hidden")).toBe("hidden");
    expect(taskbarChoice(false, "hidden")).toBe("normal");
    expect(taskbarChoice(true, "leave")).toBe("normal");
    expect(taskbarChoice(true, "autohide")).toBe("autohide");
  });
  it("includes displays and show-on-desktop from Settings > Dock", () => {
    const g = geometryFor(DEFAULT_DOCK, { showOnDesktop: true, displays: "all", lockDock: false, taskbarMode: "hidden", magnification: false, magnifyScale: 1.5, fullWidthAlign: "left", windowPreviews: true });
    expect(g).toMatchObject({ edge: "bottom", thickness: 64, displays: "all", showOnDesktop: true, taskbar: "hidden", hideTaskbar: true });
  });
});
