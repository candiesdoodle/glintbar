import { describe, expect, it } from "vitest";
import { applyFit, barMetrics, fitMinFor, forceFit, useFit } from "./fit";
import { DEFAULT_DOCK, SIZE_RANGE, stripThickness } from "./layout";

describe("screen fit", () => {
  it("leaves the bar as set at factor 1", () => {
    expect(barMetrics(DEFAULT_DOCK, 1)).toEqual({ fit: 1, size: 44, padding: 6, distance: 6, spacing: 6, thickness: 64 });
  });

  it("draws the strip at exactly the thickness Rust reserves, with the tile in whole px", () => {
    const base = stripThickness(DEFAULT_DOCK);
    for (const fit of [0.6, 0.6087, 0.75, 0.8, 0.9, 1.25, 1.5]) {
      const m = barMetrics(DEFAULT_DOCK, fit);
      expect(m.thickness).toBeCloseTo(base * fit, 9);
      expect(Number.isInteger(m.size)).toBe(true);
      // Tile + padding + border + distance fill the strip, with less than 1 px left over.
      const used = m.size + 2 * m.padding + 2 + m.distance;
      expect(used).toBeLessThanOrEqual(m.thickness + 1e-9);
      expect(m.thickness - used).toBeLessThan(1);
      expect(m.padding).toBeCloseTo(6 * fit, 9);
    }
  });

  it("works for the remote-desktop case: 78 px strip on an 865 px tall screen", () => {
    const d = { ...DEFAULT_DOCK, sizePx: 58, padding: 6, distance: 6 };
    expect(stripThickness(d)).toBe(78);
    const m = barMetrics(d, 865 / 1080);
    expect(m.thickness).toBeCloseTo(62.47, 2);
    expect(m.size).toBe(46);
  });

  it("never takes the tile below the Height slider's minimum", () => {
    for (const d of [DEFAULT_DOCK, { ...DEFAULT_DOCK, sizePx: 34 }, { ...DEFAULT_DOCK, sizePx: 120, padding: 16, distance: 40 }, { ...DEFAULT_DOCK, padding: 0, distance: 0 }]) {
      const min = fitMinFor(d);
      expect(barMetrics(d, min).size).toBeGreaterThanOrEqual(SIZE_RANGE.min);
      expect(barMetrics(d, Math.max(0.5, min)).size).toBeGreaterThanOrEqual(SIZE_RANGE.min);
    }
    // Already at (or below) the minimum: no shrinking at all.
    expect(fitMinFor({ ...DEFAULT_DOCK, sizePx: SIZE_RANGE.min })).toBe(1);
    expect(fitMinFor({ ...DEFAULT_DOCK, sizePx: 20 })).toBe(1);
  });

  it("ignores older reports and keeps a forced factor", () => {
    useFit.setState({ fit: 1, screenHeight: 0, seq: -1 });
    applyFit({ fit: 0.8, screenHeight: 865, seq: 3 });
    expect(useFit.getState()).toMatchObject({ fit: 0.8, screenHeight: 865, seq: 3 });
    applyFit({ fit: 1, screenHeight: 1440, seq: 2 });
    expect(useFit.getState().fit).toBe(0.8);
    applyFit({ fit: Number.NaN, seq: 4 });
    expect(useFit.getState()).toMatchObject({ fit: 1, screenHeight: 865 });
    forceFit(0.6);
    applyFit({ fit: 1, screenHeight: 1080, seq: 5 });
    expect(useFit.getState()).toMatchObject({ fit: 0.6, screenHeight: 1080 });
  });
});
