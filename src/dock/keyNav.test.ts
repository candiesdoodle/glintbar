import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/backend", () => ({ on: () => () => {}, call: () => Promise.resolve(null), isTauri: false }));

import { startKeyboardNav, stopKeyboardNav, useKeyboardNav } from "./keyNav";
import { renderHook } from "@testing-library/react";

function dock() {
  document.body.innerHTML = `
    <div class="g-tile-key" data-glintbar-tile="apps.apps#1" tabindex="0">
      <div role="button" aria-label="Start"></div>
      <div role="button" aria-label="Files" data-app-key="a"></div>
      <div role="button" aria-label="Mail" data-app-key="b"></div>
    </div>
    <div class="g-tile-key" data-glintbar-tile="system.cpu#1" tabindex="-1"></div>`;
}
const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const focused = () => (document.activeElement as HTMLElement).getAttribute("aria-label") ?? (document.activeElement as HTMLElement).dataset.glintbarTile;

describe("keyboard navigation", () => {
  afterEach(() => stopKeyboardNav());

  it("starts on the first app, walks the apps, then on to the next tile, and Esc leaves", () => {
    dock();
    renderHook(() => useKeyboardNav());
    startKeyboardNav();
    expect(focused()).toBe("Start");
    expect(document.documentElement.dataset.keynav).toBe("1");
    key("ArrowRight");
    expect(focused()).toBe("Files");
    key("End");
    expect(focused()).toBe("Mail");
    key("ArrowRight");
    expect(focused()).toBe("system.cpu#1");
    key("Escape");
    expect(document.documentElement.dataset.keynav).toBeUndefined();
  });

  it("Enter clicks the app and gives the focus back", () => {
    dock();
    renderHook(() => useKeyboardNav());
    const clicked = vi.fn();
    document.querySelector('[aria-label="Files"]')!.addEventListener("click", clicked);
    startKeyboardNav();
    key("ArrowRight");
    key("Enter");
    expect(clicked).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.keynav).toBeUndefined();
  });
});
