import { describe, expect, it } from "vitest";
import { searchCurrencies } from "./currencies";
import { convert, parseAmount } from "./rates";

describe("currency", () => {
  it("finds by code, country, name and with typos", () => {
    expect(searchCurrencies("eur")[0].code).toBe("EUR");
    expect(searchCurrencies("japan")[0].code).toBe("JPY");
    expect(searchCurrencies("uzbek")[0].code).toBe("UZS");
    expect(searchCurrencies("swiss")[0].code).toBe("CHF");
    expect(searchCurrencies("jpan").map((c) => c.code)).toContain("JPY");
    expect(searchCurrencies("tailand").map((c) => c.code)).toContain("THB");
    expect(searchCurrencies("ruppe").map((c) => c.code)).toContain("INR");
    expect(searchCurrencies("qqqqzz")).toHaveLength(0);
  });

  it("converts through the USD base and parses amounts", () => {
    expect(convert(100, "EUR", "GBP", { USD: 1, EUR: 0.9, GBP: 0.8 })).toBeCloseTo(88.888, 2);
    expect(convert(1, "XXX", "USD", { USD: 1 })).toBeNull();
    expect(parseAmount("1,234.5")).toBe(1234.5);
    expect(parseAmount("1 234,5")).toBe(1234.5);
    expect(parseAmount("12k")).toBe(12000);
    expect(parseAmount("abc")).toBeNull();
  });
});
