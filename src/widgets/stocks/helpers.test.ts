import { describe, expect, it } from "vitest";
import { splitPair } from "./binance";
import { parseSymbols, sampleQuote } from "./finnhub";
import { fmtPct } from "./shared";

describe("stocks helpers", () => {
  it("parses ticker lists", () => {
    expect(parseSymbols("aapl, msft  nvda,AAPL")).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(parseSymbols("a,b,c,d,e,f", 3)).toEqual(["A", "B", "C"]);
  });

  it("splits Binance pairs", () => {
    expect(splitPair("BTCUSDT")).toEqual(["BTC", "USDT"]);
    expect(splitPair("ETHBTC")).toEqual(["ETH", "BTC"]);
    expect(splitPair("SOLFDUSD")).toEqual(["SOL", "FDUSD"]);
  });

  it("formats changes and makes stable samples", () => {
    expect(fmtPct(1.234)).toBe("+1.23%");
    expect(fmtPct(-0.5)).toBe("−0.50%");
    const a = sampleQuote("AAPL");
    expect(a.line.at(-1)).toBe(a.quote.price);
    expect(sampleQuote("AAPL").line).toEqual(a.line);
  });
});
