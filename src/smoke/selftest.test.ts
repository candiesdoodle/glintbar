import { describe, expect, it } from "vitest";
import manifest from "./rust-ipc.json";
import { DENY, SAFE, shapeProblems } from "./selftest";

describe("smoke self-test lists", () => {
  it("never lists a method as both safe and denied", () => {
    expect(Object.keys(SAFE).filter((k) => k in DENY)).toEqual([]);
  });

  it("only names methods that exist in the Rust sources", () => {
    const known = new Set(manifest.methods.map((m) => m.service + "." + m.method));
    expect([...Object.keys(SAFE), ...Object.keys(DENY)].filter((k) => !known.has(k))).toEqual([]);
  });
});

describe("shapeProblems", () => {
  it("reports missing fields and type changes, not extra fields", () => {
    const mock = { a: 1, b: "x", list: [{ id: 1, name: "n" }], nested: { ok: true } };
    const real = { a: "1", list: [{ id: 2 }], nested: { ok: true }, extra: 5 };
    expect(shapeProblems(mock, real)).toEqual(["a: string (mock has number)", "b: missing (mock has string)", "list[0].name: missing (mock has string)"]);
  });

  it("accepts matching shapes and empty arrays", () => {
    expect(shapeProblems({ a: [1], b: { c: "x" } }, { a: [], b: { c: "y" } })).toEqual([]);
    expect(shapeProblems([{ a: 1 }], [{ a: 2 }])).toEqual([]);
  });

  it("flags null where the UI expects a value", () => {
    expect(shapeProblems({ a: 1 }, null)).toEqual(["result: null (mock has object)"]);
  });
});
