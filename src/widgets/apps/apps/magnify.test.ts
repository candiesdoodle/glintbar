import { describe, expect, it } from "vitest";
import { magnifyLayout, magnifyRoom, magnifyScale, type MagnifyItem } from "./Magnifier";

const item = (key: string, left: number): MagnifyItem => ({ key, rect: { left, top: 950, width: 44, height: 44 } });
const items = ["a", "b", "c", "d", "e"].map((k, i) => item(k, 100 + i * 44));

describe("magnification layout", () => {
  it("grows the icon under the pointer to the full size, upwards for a bottom dock", () => {
    const x = items[2].rect.left + 22;
    const boxes = magnifyLayout(items, x, 2, 44, "bottom");
    expect(boxes[2].scale).toBeCloseTo(2, 5);
    expect(boxes[2].height).toBeCloseTo(88, 5);
    // Bottom stays on the bar; the top rises by (scale - 1) x height.
    expect(boxes[2].top + boxes[2].height).toBeCloseTo(994, 5);
    expect(950 - boxes[2].top).toBeCloseTo(44, 5);
    // The hovered icon stays centred under the pointer.
    expect(boxes[2].left + boxes[2].width / 2).toBeCloseTo(x, 5);
    // Neighbours are smaller and pushed outwards, never overlapping.
    expect(boxes[1].scale).toBeLessThan(2);
    expect(boxes[1].left + boxes[1].width).toBeLessThanOrEqual(boxes[2].left + 0.001);
    expect(boxes[3].left).toBeGreaterThanOrEqual(boxes[2].left + boxes[2].width - 0.001);
  });

  it("grows downwards for a top dock", () => {
    const boxes = magnifyLayout(items, items[0].rect.left + 22, 1.5, 44, "top");
    expect(boxes[0].top).toBe(950);
    expect(boxes[0].height).toBeCloseTo(66, 5);
  });

  it("reserves room for the biggest icon and its name", () => {
    expect(magnifyRoom(2, 44, true)).toBe(78);
    expect(magnifyRoom(1.5, 44, false)).toBe(32);
    expect(magnifyScale(0, 1.8)).toBeCloseTo(1.8, 5);
  });
});
