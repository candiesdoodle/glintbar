import { describe, expect, it } from "vitest";
import { bytes, delta, duration, isoWeek, money, percent, relativeTime, shortNumber, timeOfDay } from "./format";

describe("format", () => {
  it("shortNumber", () => {
    expect(shortNumber(950)).toBe("950");
    expect(shortNumber(1530)).toBe("1.5k");
    expect(shortNumber(12323)).toBe("12k");
    expect(shortNumber(999_950)).toBe("1M");
    expect(shortNumber(1_250_000)).toBe("1.3M");
    expect(shortNumber(-2400)).toBe("-2.4k");
    expect(shortNumber(3.25)).toBe("3.3");
    expect(shortNumber(NaN)).toBe("–");
  });
  it("money", () => {
    expect(money(1530, "USD", { short: true })).toBe("$1.5k");
    expect(money(12.5, "USD")).toMatch(/12\.50/);
  });
  it("percent and delta", () => {
    expect(percent(42.4)).toBe("42%");
    expect(percent(0.423, { fraction: true })).toBe("42%");
    expect(delta(12)).toBe("+12%");
    expect(delta(-3.44, 1)).toBe("-3.4%");
  });
  it("duration", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(300)).toBe("5m");
    expect(duration(3900)).toBe("1h 5m");
    expect(duration(2 * 86400 + 3 * 3600)).toBe("2d 3h");
    expect(duration(309, "clock")).toBe("05:09");
    expect(duration(3909, "clock")).toBe("1:05:09");
  });
  it("relativeTime", () => {
    const now = 1_700_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now + 3 * 3600_000, now)).toBe("in 3h");
    expect(relativeTime(now - 86400_000, now)).toBe("yesterday");
  });
  it("timeOfDay", () => {
    const d = new Date(2026, 10, 16, 14, 5, 9);
    expect(timeOfDay(d)).toBe("14:05");
    expect(timeOfDay(d, { hour24: false })).toBe("2:05 PM");
    expect(timeOfDay(d, { seconds: true })).toBe("14:05:09");
  });
  it("bytes and weeks", () => {
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(512)).toBe("512 B");
    expect(isoWeek(new Date(2026, 10, 16))).toBe(47);
  });
});
