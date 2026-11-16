import { describe, expect, it } from "vitest";
import { fitAccent, parseHex, textOn, toHex } from "./color";
import { glassLook, isLightTheme, THEMES } from "./themes";
import { parseSettingsFile } from "../settings/transfer";

describe("colour helpers", () => {
  it("parses and prints hex", () => {
    expect(parseHex("#0a84ff")).toEqual({ r: 10, g: 132, b: 255 });
    expect(parseHex("fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("nope")).toBeNull();
    expect(toHex({ r: 10, g: 132, b: 255 })).toBe("#0a84ff");
  });
  it("picks readable text", () => {
    expect(textOn("#ffd60a")).toBe("#0d0d12");
    expect(textOn("#0a84ff")).toBe("#ffffff");
  });
  it("lifts near-black accents on dark themes and deepens near-white ones on light themes", () => {
    expect(fitAccent("#050505", false)).not.toBe("#050505");
    expect(fitAccent("#fafafa", true)).not.toBe("#fafafa");
    expect(fitAccent("#0a84ff", false)).toBe("#0a84ff");
  });
});

describe("themes", () => {
  it("has the six styles", () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual(["black", "clear", "glass", "ios-glass", "midnight", "white"]);
  });
  it("only glass styles (and frosted Clear) get live glass", () => {
    expect(glassLook("black", "frosted")).toBeNull();
    expect(glassLook("glass", "frosted")?.bar).toBe(true);
    expect(glassLook("clear", "frosted")?.bar).toBe(false);
    expect(glassLook("clear", "black")).toBeNull();
    expect(isLightTheme("clear", "white")).toBe(true);
  });
});

describe("settings files", () => {
  it("accepts an export and rejects anything else", () => {
    const ok = JSON.stringify({ app: "glintbar", kind: "settings", version: "0.1.0", exportedAt: "", keys: { settings: { theme: "black" } } });
    expect(parseSettingsFile(ok).keys.settings).toEqual({ theme: "black" });
    expect(() => parseSettingsFile("{}")).toThrow();
    expect(() => parseSettingsFile("not json")).toThrow();
  });
});
