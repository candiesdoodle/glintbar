import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { FloatingPanel } from "./popups";

afterEach(() => {
  document.body.innerHTML = "";
});

test("a click inside a floating panel does not reach the tile that rendered it", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const tileClick = vi.fn();
  const tileDown = vi.fn();
  const inner = vi.fn();
  const root = createRoot(host);
  act(() => {
    root.render(
      <div onClick={tileClick} onPointerDown={tileDown}>
        <FloatingPanel id="t" anchor={{ left: 100, width: 40 }} width={200}>
          <button type="button" data-testid="in" onClick={inner}>
            window
          </button>
        </FloatingPanel>
      </div>,
    );
  });
  const btn = document.querySelector<HTMLElement>('[data-testid="in"]')!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    btn.click();
  });
  expect(inner).toHaveBeenCalledTimes(1);
  expect(tileClick).not.toHaveBeenCalled();
  expect(tileDown).not.toHaveBeenCalled();
  act(() => root.unmount());
});
