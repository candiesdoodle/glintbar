import { describe, expect, it } from "vitest";
import { addInstance, patchConfig, removeInstance, reorder, stripThickness, type WidgetInstance } from "./layout";

const list: WidgetInstance[] = [
  { instanceId: "a", widgetId: "clocks.clock", config: {} },
  { instanceId: "b", widgetId: "system.cpu", config: {} },
  { instanceId: "c", widgetId: "system.cpu", config: {} },
];

describe("dock layout", () => {
  it("adds with a fresh id", () => {
    const next = addInstance(list, "clocks.clock");
    expect(next).toHaveLength(4);
    expect(new Set(next.map((i) => i.instanceId)).size).toBe(4);
  });
  it("removes", () => {
    expect(removeInstance(list, "b").map((i) => i.instanceId)).toEqual(["a", "c"]);
  });
  it("reorders and keeps unknown ids out", () => {
    expect(reorder(list, ["c", "x", "a"]).map((i) => i.instanceId)).toEqual(["c", "a", "b"]);
  });
  it("patches config of one instance", () => {
    const next = patchConfig(list, "a", { showDate: false });
    expect(next[0].config).toEqual({ showDate: false });
    expect(next[1].config).toEqual({});
  });
  it("computes strip thickness", () => {
    expect(stripThickness({ sizePx: 44, padding: 6, distance: 6 })).toBe(64);
  });
});
