import { describe, expect, it } from "vitest";
import { magnifyLayout, magnifyRamp, magnifyRoom, magnifyScale, magnifySpread, padShare, type MagnifyItem } from "./Magnifier";

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

  it("keeps every icon at rest at strength 0", () => {
    const boxes = magnifyLayout(items, items[1].rect.left + 10, 1, 44, "bottom", { left: 100, right: 320 });
    boxes.forEach((b, i) => {
      expect(b.scale).toBe(1);
      expect(b.left).toBeCloseTo(items[i].rect.left, 9);
      expect(b.top).toBe(950);
      expect(b.width).toBe(44);
    });
  });
});

describe("magnification bounds", () => {
  const max = 1.8;
  const pad = Math.ceil(magnifySpread(max) * 44);
  const left = items[0].rect.left;
  const right = items[4].rect.left + 44;
  const span = (b: { left: number; width: number }[]) => [Math.min(...b.map((x) => x.left)), Math.max(...b.map((x) => x.left + x.width))];

  it("slides the group right when it would cross the left side", () => {
    const x = items[0].rect.left + 22;
    const free = magnifyLayout(items, x, max, 44, "bottom");
    expect(span(free)[0]).toBeLessThan(left);
    const held = magnifyLayout(items, x, max, 44, "bottom", { left, right: right + 2 * pad });
    expect(span(held)[0]).toBeCloseTo(left, 9);
    held.forEach((b, i) => expect(b.left - free[i].left).toBeCloseTo(left - span(free)[0], 9));
  });

  it("slides the group left when it would cross the right side", () => {
    const x = items[4].rect.left + 22;
    const held = magnifyLayout(items, x, max, 44, "bottom", { left: left - 2 * pad, right });
    expect(span(held)[1]).toBeCloseTo(right, 9);
  });

  it("stays anchored on the pointer when the group can't fit (a dock scrolled past the screen edge)", () => {
    const x = items[4].rect.left + 22;
    const free = magnifyLayout(items, x, max, 44, "bottom");
    const held = magnifyLayout(items, x, max, 44, "bottom", { left, right });
    held.forEach((b, i) => expect(b.left).toBe(free[i].left));
  });

  it("changes nothing when the room is split evenly (a centred dock)", () => {
    for (let x = left - pad; x <= right + pad; x += 1) {
      const free = magnifyLayout(items, x, max, 44, "bottom");
      const held = magnifyLayout(items, x, max, 44, "bottom", { left: left - pad, right: right + pad });
      held.forEach((b, i) => expect(b.left).toBe(free[i].left));
    }
  });

  it("moves every box continuously as the pointer sweeps across", () => {
    for (const bounds of [undefined, { left, right: right + 2 * pad }, { left: left - 2 * pad, right }, { left: left - pad, right: right + pad }]) {
      const step = 0.25;
      let prev = magnifyLayout(items, left - 3 * pad, 2, 44, "bottom", bounds);
      let worst = 0;
      for (let x = left - 3 * pad + step; x <= right + 3 * pad; x += step) {
        const next = magnifyLayout(items, x, 2, 44, "bottom", bounds);
        next.forEach((b, i) => (worst = Math.max(worst, Math.abs(b.left - prev[i].left), Math.abs(b.width - prev[i].width))));
        prev = next;
      }
      // At scale 2 a box moves at most a few times as fast as the pointer: no jumps.
      expect(worst).toBeLessThan(4 * step);
    }
  });
});

describe("magnification easing", () => {
  it("ramps in over the full time, eased out, and ends exactly", () => {
    expect(magnifyRamp(0, 1, 0, 140)).toEqual({ value: 0, done: false });
    const half = magnifyRamp(0, 1, 70, 140).value;
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(1);
    expect(magnifyRamp(0, 1, 140, 140)).toEqual({ value: 1, done: true });
    expect(magnifyRamp(1, 0, 200, 140)).toEqual({ value: 0, done: true });
  });

  it("reverses from where it is, at the same speed", () => {
    // Fading out from 0.5 takes half the time.
    expect(magnifyRamp(0.5, 0, 70, 140)).toEqual({ value: 0, done: true });
    expect(magnifyRamp(0.5, 0, 0, 140).value).toBe(0.5);
    expect(magnifyRamp(1, 1, 0, 140)).toEqual({ value: 1, done: true });
  });
});

describe("padding split", () => {
  it("puts on the left exactly as much as the tile's left edge moved", () => {
    expect(padShare(0, 50)).toBe(0); // left-aligned or scrolling
    expect(padShare(25, 50)).toBe(0.5); // centred
    expect(padShare(50, 50)).toBe(1); // right-aligned
    expect(padShare(60, 50)).toBe(1);
    expect(padShare(-3, 50)).toBe(0);
    expect(padShare(10, 0)).toBe(0.5);
  });
});
