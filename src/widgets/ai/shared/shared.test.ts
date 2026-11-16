import { describe, expect, it } from "vitest";
import { addSample, pace, parseBalance, spentSince, type BalanceSample } from "./deepseek";
import { modelName, pct, resetShort, sumSince } from "./format";
import { parseGlm } from "./glm";
import { nextHistory } from "./history";
import { pointsFromSeries, project } from "./projection";
import { calendarItemsFor, signalsFor } from "./signals";
import { sampleReading } from "./samples";
import type { AiLimit, ToolReading } from "./types";

const H = 3_600_000;
const D = 24 * H;

describe("format", () => {
  it("names Claude models", () => {
    expect(modelName("claude-opus-4-5-20251101")).toBe("Opus 4.5");
    expect(modelName("claude-sonnet-4-20250514")).toBe("Sonnet 4");
    expect(modelName("claude-3-5-haiku-20241022")).toBe("Haiku 3.5");
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("anthropic/claude-sonnet-4-5")).toBe("Sonnet 4.5");
    expect(modelName("deepseek/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
    expect(modelName(null)).toBe("–");
  });
  it("formats percentages and resets", () => {
    expect(pct(37.4)).toBe("37%");
    expect(pct(0.3)).toBe("<1%");
    expect(pct(undefined)).toBe("–");
    expect(resetShort(1000 + 2 * H + 5, 1000)).toBe("2h");
    expect(resetShort(1000 + 3 * D, 1000)).toBe("3d");
    expect(resetShort(1000 + 30_000, 1000)).toBe("1m");
    expect(resetShort(null, 1000)).toBe("");
  });
  it("sums a series window", () => {
    expect(sumSince([[0, 1], [10, 2], [20, 3]], 10)).toBe(5);
    expect(sumSince([[0, 1], [10, 2], [20, 3]], 0, 20)).toBe(3);
  });
});

describe("projection", () => {
  const limit = (usedPct: number, elapsed: number, windowMs = 5 * H): AiLimit => ({
    tool: "claude",
    window: "session",
    label: "Session",
    usedPct,
    resetsAt: 1_000_000_000 + windowMs - elapsed,
    windowMs,
  });
  const now = 1_000_000_000;
  it("projects the average pace to the reset", () => {
    const p = project(limit(20, H), now)!;
    expect(p.projected).toBeCloseTo(100, 5);
    expect(p.runsOutAt).toBeNull();
  });
  it("says when it runs out before the reset", () => {
    const p = project(limit(50, H), now)!;
    expect(p.projected).toBeCloseTo(250, 5);
    expect(p.runsOutAt).toBe(now + H);
  });
  it("waits until some of the window has passed", () => {
    expect(project(limit(5, 60_000), now)).toBeNull();
    expect(project({ ...limit(5, H), resetsAt: null }, now)).toBeNull();
  });
  it("shapes a token series into the window's use", () => {
    const pts = pointsFromSeries([[0, 10], [100, 30], [200, 60]], 50, 300, 40, 10);
    expect(pts.map((p) => Math.round(p[1]))).toEqual([13, 40]);
    expect(pointsFromSeries([], 0, 10, 40, 1)).toEqual([]);
  });
});

describe("history", () => {
  const l = (usedPct: number, resetsAt: number): AiLimit => ({ tool: "chatgpt", window: "session", label: "5-hour", usedPct, resetsAt, windowMs: 5 * H });
  it("adds points and starts over when the window resets", () => {
    let h = nextHistory({}, [l(10, 10 * H)], 6 * H);
    h = nextHistory(h, [l(20, 10 * H)], 7 * H);
    expect(h["chatgpt:session"].points).toEqual([[6 * H, 10], [7 * H, 20]]);
    h = nextHistory(h, [l(2, 15 * H)], 11 * H);
    expect(h["chatgpt:session"].points).toEqual([[11 * H, 2]]);
  });
  it("coalesces readings less than a minute apart", () => {
    let h = nextHistory({}, [l(10, 10 * H)], 6 * H);
    h = nextHistory(h, [l(11, 10 * H)], 6 * H + 30_000);
    expect(h["chatgpt:session"].points).toEqual([[6 * H + 30_000, 11]]);
  });
});

describe("GLM", () => {
  const now = Date.UTC(2026, 10, 16, 10);
  it("reads the Coding Plan windows", () => {
    const r = parseGlm(
      {
        code: 200,
        success: true,
        data: {
          level: "pro",
          limits: [
            { type: "TIME_LIMIT", unit: 5, number: 1, usage: 1000, currentValue: 120, percentage: 12, nextResetTime: now + 18 * D },
            { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 28, nextResetTime: now + 2 * H },
            { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 35, nextResetTime: now + 3 * D },
          ],
        },
      },
      now,
    );
    expect(r.limits.map((x) => x.window)).toEqual(["session", "weekly", "monthly_mcp"]);
    expect(r.limits[0].usedPct).toBe(28);
    expect(r.plan).toBe("Coding Plan Pro");
  });
  it("rejects an answer without limits or with an error code", () => {
    expect(() => parseGlm({ code: 401, msg: "token expired", success: false }, now)).toThrow();
    expect(() => parseGlm({ data: { limits: [] } }, now)).toThrow();
  });
});

describe("DeepSeek spend", () => {
  const s = (at: number, balance: number): BalanceSample => ({ at, balance, currency: "USD" });
  it("parses the balance", () => {
    const b = parseBalance({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "0.00" }, { currency: "USD", total_balance: "18.42", granted_balance: "0", topped_up_balance: "18.42" }] }, 1);
    expect(b.currency).toBe("USD");
    expect(b.total).toBe(18.42);
    expect(() => parseBalance({ balance_infos: [] }, 1)).toThrow();
  });
  it("counts decreases and ignores top-ups", () => {
    const samples = [s(0, 10), s(H, 9.5), s(2 * H, 20), s(3 * H, 19)];
    expect(spentSince(samples, 0)).toBe(1.5);
    expect(spentSince(samples, 2 * H)).toBe(1);
    expect(spentSince(samples, 0, 2 * H)).toBe(0.5);
  });
  it("keeps one sample for an unchanged balance and drops old ones", () => {
    let list = addSample([], s(0, 10));
    list = addSample(list, s(60_000, 10));
    expect(list.length).toBe(1);
    list = addSample(list, s(120_000, 9));
    expect(list.length).toBe(2);
    expect(addSample(list, s(9 * D, 8)).length).toBe(1);
  });
  it("works out the pace once there is enough history", () => {
    const samples = [s(0, 10), s(12 * H, 9)];
    const p = pace(samples, 9, 12 * H, 0);
    expect(p.today).toBe(1);
    expect(p.perDay).toBeCloseTo(2, 5);
    expect(p.daysLeft).toBeCloseTo(4.5, 5);
    expect(pace([s(0, 10)], 10, H, 0).perDay).toBeNull();
  });
});

describe("signals", () => {
  it("publishes every window of a good reading", () => {
    const r: ToolReading = sampleReading("claude", Date.UTC(2026, 10, 16, 10));
    r.limits[0].usedPct = 91;
    const sig = signalsFor(r, 1);
    expect(sig.map((x) => x.id)).toEqual(["claude:session", "claude:weekly"]);
    expect(sig[0].nearlyOut).toBe(true);
    expect(sig[1].nearlyOut).toBe(false);
    expect(signalsFor({ ...r, status: "expired" }, 1)).toEqual([]);
  });
  it("turns resets and the renewal into calendar items", () => {
    const now = Date.UTC(2026, 10, 16, 10);
    const items = calendarItemsFor(sampleReading("chatgpt", now), now);
    expect(items.filter((i) => i.kind === "limit-reset").length).toBe(2);
    expect(items.find((i) => i.kind === "renewal")?.allDay).toBe(true);
  });
});
