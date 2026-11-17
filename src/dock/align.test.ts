import { describe, expect, it } from "vitest";
import { grownRect, toHitRect } from "./hitRegion";
import { alignFactor, fillInset, rowWidth, slotOffsets, type SlotRect } from "./layout";
import { dockAlign } from "../settings/keys";

const rects = new Map<string, SlotRect>([
  ["a", { left: 100, width: 50 }],
  ["b", { left: 160, width: 50 }],
  ["c", { left: 220, width: 50 }],
]);

describe("full-width alignment", () => {
  it("falls back to the start when the tiles overflow", () => {
    expect(alignFactor("center", false)).toBe(0.5);
    expect(alignFactor("right", false)).toBe(1);
    expect(alignFactor("left", false)).toBe(0);
    expect(alignFactor("center", true)).toBe(0);
    expect(alignFactor("right", true)).toBe(0);
    // Fill has no spare space; a tile lifted off it closes the gap towards the centre.
    expect(alignFactor("fill", false)).toBe(0.5);
    expect(alignFactor("fill", true)).toBe(0);
  });

  it("keeps a stretched tile's content at its natural width, centred", () => {
    expect(fillInset(150, 100)).toBe(25);
    // Whole px, rounded down: the content is never squeezed.
    expect(fillInset(151, 100)).toBe(25);
    expect(fillInset(100, 100)).toBe(0);
    // Narrower than natural (removing, or not laid out yet): no inset.
    expect(fillInset(60, 100)).toBe(0);
  });

  it("reads saved alignments safely", () => {
    expect(dockAlign("fill")).toBe("fill");
    expect(dockAlign("center")).toBe("center");
    expect(dockAlign("justify")).toBe("left");
    expect(dockAlign(undefined)).toBe("left");
  });

  it("measures a row", () => {
    expect(rowWidth(["a", "b", "c"], rects, 10)).toBe(170);
    expect(rowWidth(["a", "c"], rects, 10)).toBe(110);
  });

  it("re-centres a row that loses a tile, so dropping it does not jump", () => {
    const left = slotOffsets(["a", "b", "c"], ["a", "c"], rects, 10);
    expect(left.get("a")).toBe(0);
    expect(left.get("c")).toBe(-60);
    const centre = slotOffsets(["a", "b", "c"], ["a", "c"], rects, 10, 0.5);
    expect(centre.get("a")).toBe(30);
    expect(centre.get("c")).toBe(-30);
    const right = slotOffsets(["a", "b", "c"], ["a", "c"], rects, 10, 1);
    expect(right.get("c")).toBe(0);
    // A reorder keeps the row's width: no shift at all.
    expect(slotOffsets(["a", "b", "c"], ["b", "a", "c"], rects, 10, 0.5).get("c")).toBe(0);
  });
});

describe("hit region growth (magnified apps)", () => {
  it("extends away from the dock edge", () => {
    const r = { left: 10, top: 900, width: 200, height: 44 };
    expect(grownRect(r, 60, "bottom")).toEqual({ left: 10, top: 840, width: 200, height: 104 });
    expect(grownRect(r, 60, "top")).toEqual({ left: 10, top: 900, width: 200, height: 104 });
    // Bottom dock, viewport 1000 px: the grown rect reaches 60 px further from the edge.
    const hit = toHitRect(grownRect(r, 60, "bottom"), "panel", 0, "bottom", 1000, 64);
    expect(hit).toEqual({ left: 10, width: 200, near: 56, far: 160 });
  });
});
