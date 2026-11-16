/**
 * Guards every slice: each widget is discovered, has a valid id/category/size, and its tile
 * renders in sample mode (with the mocks loaded) without throwing.
 */
import { act, render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { TileHost } from "../dock/TileHost";
import { loadMocks, setMockLatency } from "./mock";
import { loadAllWidgets, widgetIds, widgetProblems } from "./registry";
import { SIZE_UNITS } from "./widget";

// Widgets are code-split; load every one up front so a test can be generated per widget.
const widgets = await loadAllWidgets();

beforeAll(async () => {
  setMockLatency(0);
  await loadMocks();
});

describe("widget registry", () => {
  it("finds the reference widgets", () => {
    const ids = widgets.map((w) => w.id);
    expect(ids).toContain("clocks.clock");
    expect(ids).toContain("system.cpu");
  });

  it("has no problems", () => {
    expect(widgetProblems).toEqual([]);
    expect(widgets.length).toBe(widgetIds.length);
  });

  it("gives every account widget a way back from connected", () => {
    // Custom Connect flows that only detect a local sign-in (AI tools) have nothing to forget.
    const local = (id: string) => id.startsWith("ai.") && !widgets.find((w) => w.id === id)?.connect;
    const missing = widgets.filter((w) => w.Connect && !w.disconnect && !local(w.id)).map((w) => w.id);
    expect(missing).toEqual([]);
  });

  for (const def of widgets) {
    it(`${def.id} renders its tile`, async () => {
      expect(SIZE_UNITS[def.size]).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(10);
      const r = render(
        <TileHost def={def} instanceId={`test:${def.id}`} config={{}} height={44} isSample visible openCard={() => {}} setConfig={() => {}} />,
      );
      await act(async () => {
        await new Promise((res) => setTimeout(res, 20));
      });
      expect(r.container.textContent).not.toBe("!");
      r.unmount();
    });
  }
});
