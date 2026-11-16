import { describe, expect, it } from "vitest";
import { dayRelation, formatHM, offsetLabel, zoned } from "./zones";

describe("zones", () => {
  it("reads the wall clock of a zone", () => {
    const d = new Date(Date.UTC(2026, 10, 16, 23, 30, 0));
    const tokyo = zoned(d, "Asia/Tokyo");
    expect([tokyo.hour, tokyo.minute, tokyo.day, tokyo.offset]).toEqual([8, 30, 17, 540]);
    const kolkata = zoned(d, "Asia/Kolkata");
    expect(kolkata.offset).toBe(330);
    expect(zoned(d, "UTC").hour).toBe(23);
  });

  it("formats offsets and times", () => {
    expect(offsetLabel(330)).toBe("+5:30");
    expect(offsetLabel(-480)).toBe("-8");
    expect(formatHM({ hour: 14, minute: 5 }, true)).toEqual({ main: "14:05", period: "" });
    expect(formatHM({ hour: 0, minute: 7 }, false)).toEqual({ main: "12:07", period: "AM" });
  });

  it("names tomorrow and yesterday", () => {
    const local = new Date(2026, 10, 16, 12);
    expect(dayRelation({ hour: 1, minute: 0, second: 0, weekday: 2, day: 17, month: 10, year: 2026, offset: 0 }, local)).toBe("Tomorrow");
    expect(dayRelation({ hour: 1, minute: 0, second: 0, weekday: 0, day: 15, month: 10, year: 2026, offset: 0 }, local)).toBe("Yesterday");
  });
});
