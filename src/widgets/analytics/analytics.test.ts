import { describe, expect, it } from "vitest";
import { lastDays } from "../finance/shared/sample";
import { weekOf } from "../finance/shared/series";
import { datafastSeries } from "./datafast/api";
import { dubDaily } from "./dub/api";
import { plausibleDaily, plausibleServer } from "./plausible/api";
import { map403, periodDays, siteLabel, summarize } from "./search-console/api";

const now = new Date(2026, 10, 16, 12);
const days = lastDays(14, now);

describe("analytics mappings", () => {
  it("DataFast timeseries + overview -> 14-day series and stats", () => {
    const s = datafastSeries(
      { status: "success", data: [{ timestamp: "2026-11-16T00:00:00Z", visitors: 528 }, { timestamp: "2026-11-10T00:00:00Z", visitors: 400 }] },
      { status: "success", data: [{ visitors: 12450, sessions: 16890, bounce_rate: 42.1, avg_session_duration: 68, currency: "USD", revenue: 28450, conversion_rate: 2.63 }] },
      days,
    );
    expect(s.values).toHaveLength(14);
    expect(s.values[13]).toBe(528);
    expect(s.values[7]).toBe(400);
    expect(s.stats?.find((x) => x.label === "Bounce rate")?.value).toBe("42%");
    expect(s.stats?.find((x) => x.label === "Conversion")?.value).toBe("2.6%");
    expect(weekOf(s).value).toBe(928);
  });

  it("Plausible v2 rows align onto days", () => {
    const v = plausibleDaily({ results: [{ metrics: [99], dimensions: ["2026-11-03"] }, { metrics: [7], dimensions: ["2026-11-16"] }] }, days);
    expect(v[0]).toBe(99);
    expect(v[13]).toBe(7);
    expect(v.reduce((a, b) => a + b, 0)).toBe(106);
    expect(plausibleServer({ secret: () => "", settings: {}, testing: false })).toBe("https://plausible.io");
    expect(plausibleServer({ secret: () => "", settings: { server: "stats.example.com/" }, testing: false })).toBe("https://stats.example.com");
  });

  it("Dub timeseries buckets map to local days", () => {
    const start = new Date(2026, 10, 15).toISOString();
    const v = dubDaily([{ start, clicks: 120 }], days);
    expect(v[12]).toBe(120);
  });

  it("Search Console splits the period from the one before", () => {
    const { days: d, prevDays } = periodDays(7, now);
    expect(d[6]).toBe("2026-11-15");
    expect(prevDays[0]).toBe("2026-11-02");
    const rows = [
      { keys: ["2026-11-15"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { keys: ["2026-11-14"], clicks: 30, impressions: 300, ctr: 0.1, position: 10 },
      { keys: ["2026-11-05"], clicks: 20, impressions: 400, ctr: 0.05, position: 20 },
    ];
    const s = summarize(rows, d, prevDays);
    expect(s.clicks[6]).toBe(10);
    expect(s.totals.clicks).toBe(40);
    expect(s.totals.ctr).toBeCloseTo(0.1);
    expect(s.totals.position).toBeCloseTo((5 * 100 + 10 * 300) / 400);
    expect(s.prev.clicks).toBe(20);
    expect(siteLabel("sc-domain:example.com")).toBe("example.com");
    expect(map403("Google Search Console API is disabled for project 1.")).toMatch(/Search Console API is switched off/);
  });
});
