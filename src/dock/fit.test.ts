import { describe, expect, it } from "vitest";
import { useDockPrefs } from "../settings/keys";
import { applyFit, barMetrics, editDockMeasures, fitMaxFor, fitMinFor, forceFit, heightLabel, initFitReference, rebaseToScreen, useFit } from "./fit";
import { DEFAULT_DOCK, SIZE_PRESETS, SIZE_RANGE, stripThickness, useDock } from "./layout";

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

  it("never takes the tile above the Height slider's maximum", () => {
    for (const d of [DEFAULT_DOCK, { ...DEFAULT_DOCK, sizePx: 100 }, { ...DEFAULT_DOCK, sizePx: 34, padding: 16, distance: 40 }]) {
      const max = fitMaxFor(d);
      expect(barMetrics(d, max).size).toBeLessThanOrEqual(SIZE_RANGE.max);
      expect(barMetrics(d, max + 0.01).size).toBeGreaterThan(SIZE_RANGE.max - 2);
    }
    expect(fitMaxFor({ ...DEFAULT_DOCK, sizePx: SIZE_RANGE.max })).toBe(1);
  });

  it("labels the height as a share of the screen", () => {
    expect(heightLabel(44, 1440)).toBe("3.1 % · 44 px");
    expect(heightLabel(26, 864)).toBe("3.0 % · 26 px");
    expect(heightLabel(44, 0)).toBe("44 px");
  });
});

describe("moving the sizes to this screen", () => {
  const large = { ...DEFAULT_DOCK, sizePx: SIZE_PRESETS.l, sizePreset: "l" as const };

  it("does nothing at factor 1", () => {
    expect(rebaseToScreen(DEFAULT_DOCK, 1)).toBeNull();
    expect(rebaseToScreen(DEFAULT_DOCK, Number.NaN)).toBeNull();
  });

  it("takes what is drawn: set on a 1440 px screen, shown on an 864 px one", () => {
    // 58 px tiles in a 78 px strip at 0.6: 46.8 - 2 x 3.6 - 3.6 - 2 = 34 px, which is the S preset.
    expect(rebaseToScreen(large, 864 / 1440)).toEqual({ sizePx: 34, sizePreset: "s", padding: 4, spacing: 4, distance: 4 });
  });

  it("rounds to whole px and stays within each slider's range", () => {
    expect(rebaseToScreen({ ...DEFAULT_DOCK, padding: 5, spacing: 5, distance: 5 }, 0.7)).toMatchObject({ padding: 4, spacing: 4, distance: 4 });
    expect(rebaseToScreen({ sizePx: 120, padding: 16, spacing: 24, distance: 40 }, 1.5)).toEqual({ sizePx: 120, sizePreset: "custom", padding: 16, spacing: 24, distance: 40 });
    expect(rebaseToScreen({ sizePx: 26, padding: 0, spacing: 0, distance: 0 }, 0.5)).toMatchObject({ sizePx: SIZE_RANGE.min, padding: 0 });
  });

  it("an edit on a scaled screen moves every size there first, then applies the edit", () => {
    useDock.setState({ ...large });
    useDockPrefs.setState({ screenFitRef: 1440 });
    useFit.setState({ fit: 0.6, screenHeight: 864, seq: 1 });
    editDockMeasures({ spacing: 10 });
    expect(useDock.getState()).toMatchObject({ sizePx: 34, sizePreset: "s", padding: 4, distance: 4, spacing: 10 });
    expect(useDockPrefs.getState().screenFitRef).toBe(864);
    expect(useFit.getState().fit).toBe(1);
    // At factor 1 an edit is just the edit.
    editDockMeasures({ sizePx: 44 });
    expect(useDock.getState()).toMatchObject({ sizePx: 44, sizePreset: "m", padding: 4, spacing: 10 });
    expect(useDockPrefs.getState().screenFitRef).toBe(864);
  });

  it("sets the reference height once, from the first known screen height", () => {
    useDockPrefs.setState({ screenFitRef: 0 });
    useFit.setState({ fit: 1, screenHeight: 0, seq: -1 });
    const off = initFitReference();
    expect(useDockPrefs.getState().screenFitRef).toBe(0);
    applyFit({ fit: 1, screenHeight: 1440, seq: 1 });
    expect(useDockPrefs.getState().screenFitRef).toBe(1440);
    applyFit({ fit: 0.6, screenHeight: 864, seq: 2 });
    expect(useDockPrefs.getState().screenFitRef).toBe(1440);
    off();
  });
});
