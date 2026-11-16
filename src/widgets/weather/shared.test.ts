import { describe, expect, it } from "vitest";
import { condition, sentence } from "./conditions";
import { compass, sampleWeather, temp, today, wind } from "./shared";

describe("weather helpers", () => {
  it("formats temperatures and wind in both units", () => {
    expect(temp(21.4, "c")).toBe("21°");
    expect(temp(-0.3, "c")).toBe("0°");
    expect(temp(20, "f")).toBe("68°");
    expect(wind(16.09, "f")).toBe("10 mph");
    expect(compass(350)).toBe("N");
    expect(compass(225)).toBe("SW");
  });

  it("describes codes", () => {
    expect(condition(61).label).toBe("Light rain");
    expect(sentence(0, true, "Lisbon")).toBe("Clear in Lisbon");
  });

  it("sample weather has today first", () => {
    const w = sampleWeather();
    expect(w.daily).toHaveLength(7);
    expect(today(w)).toBe(w.daily[0]);
    expect(w.hourly[0].time).toBeLessThanOrEqual(Date.now());
  });
});
