import { describe, expect, it } from "vitest";
import { addSample, dayNumber, daysUntilFull } from "./forecast";

const GB = 1024 ** 3;

describe("storage forecast", () => {
  it("projects when a filling drive is full", () => {
    const samples: Array<[number, number]> = [];
    for (let d = 0; d < 10; d++) samples.push([d, 100 * GB - d * 2 * GB]);
    expect(daysUntilFull(samples, 82 * GB)).toBe(41);
  });

  it("says nothing without a trend", () => {
    expect(daysUntilFull([[0, 50 * GB], [1, 50 * GB]], 50 * GB)).toBe(null);
    expect(daysUntilFull([[0, 50 * GB], [5, 51 * GB], [9, 52 * GB]], 52 * GB)).toBe(null);
  });

  it("keeps one sample a day", () => {
    const now = Date.UTC(2026, 10, 16, 12);
    let h = addSample({}, "C:\\", 10, now);
    h = addSample(h, "C:\\", 9, now + 3600_000);
    expect(h["C:\\"]).toEqual([[dayNumber(now), 9]]);
  });
});
