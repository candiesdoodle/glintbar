import { describe, expect, it } from "vitest";
import { backoffMs, cacheKey, PlainError } from "./poll";
import { bucket, entryDay, minorFactor, summarize } from "./revenue";
import { dayKey, lastDays } from "./sample";
import { stripeEntries } from "./providers/stripe";
import { nextMilestone, polarEntries } from "./providers/polar";
import { dodoLedgerEntries, dodoPaymentEntries } from "./providers/dodo";
import { normalizeStore, shopifyEntries } from "./providers/shopify";
import { lemonEntries } from "./providers/lemonsqueezy";
import { paddleEntries } from "./providers/paddle";
import { gumroadEntries } from "./providers/gumroad";
import { HttpError } from "../../../core/http";

const now = new Date(2026, 10, 16, 15, 0);
const days = lastDays(31, now);
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

describe("shared revenue helpers", () => {
  it("knows zero-decimal currencies", () => {
    expect(minorFactor("usd")).toBe(100);
    expect(minorFactor("JPY")).toBe(1);
  });

  it("buckets by local day and keeps the biggest currency", () => {
    const r = bucket(
      {
        entries: [
          { at: localNoon(2026, 11, 16), amount: 10, currency: "usd" },
          { at: localNoon(2026, 11, 16), amount: 5.5, currency: "USD" },
          { at: "2026-11-15", amount: 20, currency: "USD" },
          { at: localNoon(2026, 11, 15), amount: 3, currency: "EUR" },
          { at: localNoon(2026, 9, 1), amount: 999, currency: "USD" }, // out of range
        ],
      },
      days,
    );
    expect(r.currency).toBe("USD");
    expect(r.others).toEqual(["EUR"]);
    expect(r.days).toHaveLength(31);
    expect(r.days[30]).toEqual({ date: "2026-11-16", net: 15.5, currency: "USD" });
    expect(r.days[29].net).toBe(20);
  });

  it("summarizes today, weeks and 30 days", () => {
    const pts = days.map((date, i) => ({ date, net: i < 17 ? 1 : i < 24 ? 10 : 20, currency: "USD" }));
    const s = summarize(pts);
    expect(s.today).toBe(20);
    expect(s.week).toBe(140);
    expect(s.prevWeek).toBe(70);
    expect(s.weekChange).toBeCloseTo(100);
    expect(s.month).toBe(16 * 1 + 70 + 140);
    expect(s.chart).toHaveLength(14);
  });

  it("reads exact days and ISO midnights as that day", () => {
    expect(entryDay("2026-11-01")).toBe("2026-11-01");
    expect(entryDay("2026-11-01T00:00:00Z")).toBe("2026-11-01");
  });

  it("backs off and waits a full period for rejected keys", () => {
    expect(cacheKey("finance.stripe:revenue")).toBe("finance.cache.stripe:revenue");
    expect(backoffMs(new HttpError("offline"), 1, 900_000)).toBe(30_000);
    expect(backoffMs(new HttpError("offline"), 3, 900_000)).toBe(120_000);
    expect(backoffMs(new HttpError("offline"), 10, 900_000)).toBe(900_000);
    expect(backoffMs(new HttpError("unauthorized"), 1, 900_000)).toBe(900_000);
    expect(backoffMs(new PlainError("This key can't read payments"), 1, 900_000)).toBe(900_000);
  });
});

describe("providers map API responses to entries", () => {
  it("Stripe: charges and refunds count, payouts and fees do not", () => {
    const { entries, count } = stripeEntries([
      { id: "txn_1", amount: 1000, fee: 59, net: 941, currency: "usd", created: 1763290000, type: "charge" },
      { id: "txn_2", amount: -500, fee: 0, net: -500, currency: "usd", created: 1763290100, type: "refund" },
      { id: "txn_3", amount: -20000, fee: 0, net: -20000, currency: "usd", created: 1763290200, type: "payout" },
      { id: "txn_4", amount: -300, fee: 0, net: -300, currency: "usd", created: 1763290300, type: "stripe_fee" },
      { id: "txn_5", amount: 5000, fee: 0, net: 4800, currency: "jpy", created: 1763290400, type: "payment" },
    ]);
    expect(count).toBe(2);
    expect(entries.map((e) => e.amount)).toEqual([9.41, -5, 4800]);
    expect(entries[2].currency).toBe("JPY");
    expect(entries[0].at).toBe(1763290000 * 1000);
  });

  it("Polar: net_revenue cents per period", () => {
    const { entries, count } = polarEntries(
      {
        periods: [
          { timestamp: "2026-11-15T00:00:00Z", orders: 3, revenue: 15000, net_revenue: 14000 },
          { timestamp: "2026-11-16T00:00:00Z", orders: 1, revenue: 2900, net_revenue: null },
        ],
        totals: { orders: 4 },
      },
      "EUR",
    );
    expect(entries).toEqual([
      { at: "2026-11-15", amount: 140, currency: "EUR" },
      { at: "2026-11-16", amount: 0, currency: "EUR" },
    ]);
    expect(count).toBe(4);
  });

  it("Polar milestones project from the 30-day pace", () => {
    expect(nextMilestone(8000, 100, now)).toEqual({ amount: 10_000, date: "2026-12-06" });
    expect(nextMilestone(8000, 0, now)).toBeUndefined();
    expect(nextMilestone(9_999, 0.001, now)).toBeUndefined();
  });

  it("Dodo: ledger credits minus debits, payouts left out; payments fallback is gross", () => {
    const ledger = dodoLedgerEntries([
      { id: "l1", event_type: "payment", amount: 1999, currency: "USD", is_credit: true, created_at: "2026-11-15T10:30:00Z" },
      { id: "l2", event_type: "payment_fees", amount: 120, currency: "USD", is_credit: false, created_at: "2026-11-15T10:30:00Z" },
      { id: "l3", event_type: "tax", amount: 300, currency: "USD", is_credit: false, created_at: "2026-11-15T10:30:00Z" },
      { id: "l4", event_type: "payout", amount: 50000, currency: "USD", is_credit: false, created_at: "2026-11-15T10:30:00Z" },
      { id: "l5", event_type: "refund", amount: 999, currency: "USD", is_credit: false, created_at: "2026-11-15T11:00:00Z" },
    ]);
    expect(ledger.count).toBe(1);
    expect(ledger.entries.reduce((a, e) => a + e.amount, 0)).toBeCloseTo(19.99 - 1.2 - 3 - 9.99);
    const pay = dodoPaymentEntries([
      { payment_id: "p1", total_amount: 1999, currency: "USD", status: "succeeded", created_at: "2026-11-15T10:30:00Z" },
      { payment_id: "p2", total_amount: 500, currency: "USD", status: "failed", created_at: "2026-11-15T10:30:00Z" },
    ]);
    expect(pay.entries).toEqual([{ at: "2026-11-15T10:30:00Z", amount: 19.99, currency: "USD" }]);
  });

  it("Shopify: current totals, without test and cancelled orders", () => {
    const { entries, count } = shopifyEntries([
      { id: "gid://shopify/Order/1", createdAt: "2026-11-15T09:00:00Z", test: false, cancelledAt: null, currentTotalPriceSet: { shopMoney: { amount: "58.40", currencyCode: "CAD" } } },
      { id: "gid://shopify/Order/2", createdAt: "2026-11-15T09:10:00Z", test: true, cancelledAt: null, currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "CAD" } } },
      { id: "gid://shopify/Order/3", createdAt: "2026-11-15T09:20:00Z", test: false, cancelledAt: "2026-11-15T10:00:00Z", currentTotalPriceSet: { shopMoney: { amount: "99.00", currencyCode: "CAD" } } },
    ]);
    expect(count).toBe(1);
    expect(entries).toEqual([{ at: "2026-11-15T09:00:00Z", amount: 58.4, currency: "CAD" }]);
    expect(normalizeStore("https://My-Store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(() => normalizeStore("shop.example.com")).toThrow(/myshopify/);
  });

  it("Lemon Squeezy: total less tax and refunds, in USD", () => {
    const r = lemonEntries([
      { id: "1", attributes: { status: "paid", total_usd: 1999, tax_usd: 200, refunded_amount_usd: 0, created_at: "2026-11-15T09:45:53.000000Z", test_mode: false } },
      { id: "2", attributes: { status: "partial_refund", total_usd: 5000, tax_usd: 500, refunded_amount_usd: 1500, created_at: "2026-11-14T09:45:53.000000Z", test_mode: false } },
      { id: "3", attributes: { status: "pending", total_usd: 900, tax_usd: 0, created_at: "2026-11-14T09:45:53.000000Z", test_mode: true } },
    ]);
    expect(r.entries.map((e) => e.amount)).toEqual([17.99, 30]);
    expect(r.count).toBe(1);
    expect(r.testMode).toBe(true);
  });

  it("Paddle: adjusted earnings, falling back to total - tax - fee", () => {
    const { entries } = paddleEntries([
      { id: "txn_1", status: "completed", created_at: "2026-11-15T10:00:00Z", billed_at: "2026-11-15T10:00:05Z", details: { totals: { total: "1200", tax: "200", fee: "60", earnings: "940", currency_code: "USD" }, adjusted_totals: { total: "600", tax: "100", fee: "60", earnings: "440", currency_code: "USD" } } },
      { id: "txn_2", status: "completed", created_at: "2026-11-15T11:00:00Z", details: { totals: { total: "2400", tax: "400", fee: "120", earnings: null, currency_code: "EUR" } } },
      { id: "txn_3", status: "completed", created_at: "2026-11-15T12:00:00Z", details: { totals: { total: "1000", tax: "0", fee: "50", earnings: "950", currency_code: "JPY" } } },
    ]);
    expect(entries.map((e) => e.amount)).toEqual([4.4, 18.8, 950]);
    expect(entries[0].at).toBe("2026-11-15T10:00:05Z");
  });

  it("Gumroad: price less fee, refunds and chargebacks left out", () => {
    const { entries, count } = gumroadEntries([
      { id: "s1", created_at: "2026-11-15T19:38:56Z", price: 1500, gumroad_fee: 165, currency: "usd" },
      { id: "s2", created_at: "2026-11-15T19:40:00Z", price: 1500, gumroad_fee: 165, currency: "usd", refunded: true },
      { id: "s3", created_at: "2026-11-15T19:41:00Z", price: 900, gumroad_fee: 99, currency: "usd", disputed: true, dispute_won: true },
      { id: "s4", created_at: "2026-11-15T19:42:00Z", price: 900, gumroad_fee: 99, currency: "usd", chargedback: true },
    ]);
    expect(count).toBe(2);
    expect(entries.map((e) => e.amount)).toEqual([13.35, 8.01]);
    expect(dayKey(new Date(entries[0].at))).toMatch(/^2026-11-1[56]$/);
  });
});
